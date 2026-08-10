using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading.RateLimiting;
using BibleTimeline.NotesApi.Endpoints;
using BibleTimeline.NotesApi.Infrastructure;
using BibleTimeline.NotesApi.Options;
using BibleTimeline.NotesApi.Services;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.IdentityModel.Tokens;

const string DevCorsPolicy = "dev-open-cors";

var builder = WebApplication.CreateBuilder(args);

// ── Options ───────────────────────────────────────────────────────────────────
builder.Services
    .AddOptions<NotesApiOptions>()
    .Bind(builder.Configuration.GetSection(NotesApiOptions.SectionName))
    .ValidateDataAnnotations()
    .ValidateOnStart();

var notesOpts = builder.Configuration
    .GetSection(NotesApiOptions.SectionName)
    .Get<NotesApiOptions>() ?? new NotesApiOptions();
if (!builder.Environment.IsDevelopment())
{
    if (notesOpts.ConnectionString.Contains("Password=postgres", StringComparison.OrdinalIgnoreCase))
        throw new InvalidOperationException("NotesApi:ConnectionString must not use the default postgres password in production.");
    if (notesOpts.JwtSecret.Contains("CHANGE_THIS", StringComparison.OrdinalIgnoreCase))
        throw new InvalidOperationException("NotesApi:JwtSecret must be replaced in production.");
    if (!Uri.TryCreate(notesOpts.FrontendBaseUrl, UriKind.Absolute, out var frontendUri) ||
        frontendUri.Scheme != Uri.UriSchemeHttps)
        throw new InvalidOperationException("NotesApi:FrontendBaseUrl must be an absolute HTTPS URL in production.");
}

// ── Infrastructure & services ─────────────────────────────────────────────────
builder.Services.AddSingleton<NpgsqlConnectionFactory>();
builder.Services.AddSingleton<TokenService>();
builder.Services.AddSingleton<AuthService>();
builder.Services.AddSingleton<NotesService>();
builder.Services.AddSingleton<OAuthService>();
builder.Services.AddMemoryCache();
builder.Services.AddHttpClient("oauth");

// ── JWT authentication ────────────────────────────────────────────────────────
builder.Services
    .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.MapInboundClaims = false;
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer           = true,
            ValidateAudience         = true,
            ValidateLifetime         = true,
            ValidateIssuerSigningKey = true,
            ValidIssuer              = notesOpts.JwtIssuer,
            ValidAudience            = notesOpts.JwtAudience,
            IssuerSigningKey         = new SymmetricSecurityKey(
                Encoding.UTF8.GetBytes(notesOpts.JwtSecret)),
            ClockSkew = TimeSpan.FromSeconds(30),
        };
    });

builder.Services.AddAuthorization();

// ── Rate limiting ─────────────────────────────────────────────────────────────
builder.Services.AddRateLimiter(opts =>
{
    opts.AddFixedWindowLimiter("login", o =>
    {
        o.Window               = TimeSpan.FromMinutes(10);
        o.PermitLimit          = 5;
        o.QueueProcessingOrder = QueueProcessingOrder.OldestFirst;
        o.QueueLimit           = 0;
    });
    opts.AddFixedWindowLimiter("register", o =>
    {
        o.Window               = TimeSpan.FromMinutes(10);
        o.PermitLimit          = 3;
        o.QueueProcessingOrder = QueueProcessingOrder.OldestFirst;
        o.QueueLimit           = 0;
    });
    opts.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
});

// ── JSON ──────────────────────────────────────────────────────────────────────
builder.Services.ConfigureHttpJsonOptions(opts =>
{
    opts.SerializerOptions.PropertyNamingPolicy   = JsonNamingPolicy.CamelCase;
    opts.SerializerOptions.DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull;
});

// ── OpenAPI ───────────────────────────────────────────────────────────────────
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(c =>
{
    c.AddSecurityDefinition("Bearer", new Microsoft.OpenApi.Models.OpenApiSecurityScheme
    {
        In          = Microsoft.OpenApi.Models.ParameterLocation.Header,
        Name        = "Authorization",
        Type        = Microsoft.OpenApi.Models.SecuritySchemeType.Http,
        Scheme      = "bearer",
        BearerFormat = "JWT",
    });
    c.AddSecurityRequirement(new Microsoft.OpenApi.Models.OpenApiSecurityRequirement
    {
        {
            new Microsoft.OpenApi.Models.OpenApiSecurityScheme
            {
                Reference = new Microsoft.OpenApi.Models.OpenApiReference
                    { Type = Microsoft.OpenApi.Models.ReferenceType.SecurityScheme, Id = "Bearer" }
            },
            []
        }
    });
});

// ── CORS (dev only) ───────────────────────────────────────────────────────────
builder.Services.AddCors(options =>
{
    options.AddPolicy(DevCorsPolicy, policy =>
        policy.AllowAnyOrigin().AllowAnyHeader().AllowAnyMethod());
});

// ── Build & pipeline ──────────────────────────────────────────────────────────
var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
    app.UseCors(DevCorsPolicy);
}

app.UseRateLimiter();
app.UseAuthentication();
app.UseAuthorization();

app.MapGet("/health", () => Results.Ok(new { status = "ok" }))
    .WithName("NotesHealth")
    .WithTags("Meta");

app.MapAuthEndpoints();
app.MapNotesEndpoints();

app.Run();

public partial class Program { }
