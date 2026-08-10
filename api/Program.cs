using System.Text.Json;
using System.Text.Json.Serialization;
using BibleTimeline.Api.Endpoints;
using BibleTimeline.Api.Infrastructure;
using BibleTimeline.Api.Options;
using BibleTimeline.Api.Services;

const string DevCorsPolicy = "dev-open-cors";

var builder = WebApplication.CreateBuilder(args);

// ---- Options ---------------------------------------------------------------
builder.Services
    .AddOptions<BibleTimelineOptions>()
    .Bind(builder.Configuration.GetSection(BibleTimelineOptions.SectionName))
    .ValidateDataAnnotations()
    .ValidateOnStart();

var bibleTimelineOptions = builder.Configuration
    .GetSection(BibleTimelineOptions.SectionName)
    .Get<BibleTimelineOptions>() ?? new BibleTimelineOptions();
if (!builder.Environment.IsDevelopment() &&
    bibleTimelineOptions.ConnectionString.Contains("Password=postgres", StringComparison.OrdinalIgnoreCase))
{
    throw new InvalidOperationException("BibleTimeline:ConnectionString must not use the default postgres password in production.");
}

// ---- Infrastructure & services --------------------------------------------
builder.Services.AddSingleton<NpgsqlConnectionFactory>();
builder.Services.AddSingleton<TimelineViewportService>();
builder.Services.AddSingleton<BibleReadingService>();
builder.Services.AddSingleton<SearchService>();
builder.Services.AddSingleton<EventDetailService>();
builder.Services.AddSingleton<StrongService>();

// ---- JSON ------------------------------------------------------------------
builder.Services.ConfigureHttpJsonOptions(options =>
{
    options.SerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
    options.SerializerOptions.DictionaryKeyPolicy = null; // preserve version codes like "RV60"
    options.SerializerOptions.DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull;
});

// ---- OpenAPI ---------------------------------------------------------------
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

// ---- CORS (dev only: allow any origin; tighten in prod) -------------------
builder.Services.AddCors(options =>
{
    options.AddPolicy(DevCorsPolicy, policy =>
    {
        policy
            .AllowAnyOrigin()
            .AllowAnyHeader()
            .AllowAnyMethod();
    });
});

// ---- Build & pipeline ------------------------------------------------------
var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
    app.UseCors(DevCorsPolicy);
}

// ---- Health ----------------------------------------------------------------
app.MapGet("/health", () => Results.Ok(new { status = "ok" }))
    .WithName("Health")
    .WithTags("Meta");

// ---- Endpoints --------------------------------------------------------------
app.MapTimelineEndpoints();
app.MapBibleEndpoints();
app.MapSearchEndpoints();
app.MapStrongEndpoints();

app.Run();

/// <summary>
/// Exposed for WebApplicationFactory-based integration tests.
/// </summary>
public partial class Program { }
