using System.Collections.Concurrent;
using System.IdentityModel.Tokens.Jwt;
using System.Net;
using System.Net.Sockets;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Threading.RateLimiting;
using HtmlAgilityPack;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.IdentityModel.Tokens;
using Npgsql;

const string AdminLoginRateLimit = "admin-login";
const string AdminSetupRateLimit = "admin-setup";
const string AdminUnfurlRateLimit = "admin-unfurl";
const int MaxUnfurlBytes = 256 * 1024;
const int MaxUnfurlRedirects = 3;

var builder = WebApplication.CreateBuilder(args);

var connStr = builder.Configuration.GetConnectionString("Default")
    ?? throw new InvalidOperationException("Missing ConnectionStrings:Default");

var jwtSecret   = builder.Configuration["Jwt:Secret"]   ?? throw new InvalidOperationException("Missing Jwt:Secret");
var jwtIssuer   = builder.Configuration["Jwt:Issuer"]   ?? "content-admin-api";
var jwtAudience = builder.Configuration["Jwt:Audience"] ?? "content-admin";
if (jwtSecret.Length < 32)
    throw new InvalidOperationException("Jwt:Secret must be at least 32 characters.");

var setupEnabled = builder.Configuration.GetValue("Setup:Enabled", builder.Environment.IsDevelopment());
var setupToken   = builder.Configuration["Setup:Token"];
var corsAllowedOrigins = ParseCsv(builder.Configuration["Cors:AllowedOrigins"]);

builder.Services.AddSingleton(_ => NpgsqlDataSource.Create(connStr));
builder.Services.AddHttpClient("unfurl", client =>
{
    client.Timeout = TimeSpan.FromSeconds(5);
    client.MaxResponseContentBufferSize = MaxUnfurlBytes;
    client.DefaultRequestHeaders.UserAgent.ParseAdd("BibleTimelineBot/1.0");
}).ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler
{
    AllowAutoRedirect = false,
});

// Refresh token store — in-memory; restart invalidates all sessions (acceptable for admin tool)
var refreshTokens = new ConcurrentDictionary<string, string>();

builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(o =>
    {
        o.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer           = true,
            ValidateAudience         = true,
            ValidateLifetime         = true,
            ValidateIssuerSigningKey = true,
            ValidIssuer              = jwtIssuer,
            ValidAudience            = jwtAudience,
            IssuerSigningKey         = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtSecret)),
            ClockSkew                = TimeSpan.Zero,
        };
    });

builder.Services.AddAuthorization();

builder.Services.AddCors(o => o.AddDefaultPolicy(p =>
{
    if (builder.Environment.IsDevelopment() && corsAllowedOrigins.Length == 0)
        p.AllowAnyOrigin().AllowAnyMethod().AllowAnyHeader();
    else if (corsAllowedOrigins.Length > 0)
        p.WithOrigins(corsAllowedOrigins).AllowAnyMethod().AllowAnyHeader();
}));

builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    o.AddPolicy(AdminLoginRateLimit, http =>
        RateLimitPartition.GetFixedWindowLimiter(GetClientKey(http), _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = 5,
            Window = TimeSpan.FromMinutes(10),
            QueueProcessingOrder = QueueProcessingOrder.OldestFirst,
            QueueLimit = 0,
        }));
    o.AddPolicy(AdminSetupRateLimit, http =>
        RateLimitPartition.GetFixedWindowLimiter(GetClientKey(http), _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = 3,
            Window = TimeSpan.FromHours(1),
            QueueProcessingOrder = QueueProcessingOrder.OldestFirst,
            QueueLimit = 0,
        }));
    o.AddPolicy(AdminUnfurlRateLimit, http =>
        RateLimitPartition.GetFixedWindowLimiter(GetClientKey(http), _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = 20,
            Window = TimeSpan.FromMinutes(1),
            QueueProcessingOrder = QueueProcessingOrder.OldestFirst,
            QueueLimit = 0,
        }));
});

var app = builder.Build();
app.UseCors();
app.UseRateLimiter();
app.UseAuthentication();
app.UseAuthorization();

// ── Helpers ───────────────────────────────────────────────────────────────────

string MakeAccessToken(string email)
{
    var key   = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtSecret));
    var creds = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);
    var token = new JwtSecurityToken(
        issuer:             jwtIssuer,
        audience:           jwtAudience,
        claims:             [new Claim(ClaimTypes.Email, email), new Claim(ClaimTypes.Role, "admin")],
        expires:            DateTime.UtcNow.AddMinutes(15),
        signingCredentials: creds);
    return new JwtSecurityTokenHandler().WriteToken(token);
}

static string MakeRefreshToken() =>
    Convert.ToBase64String(RandomNumberGenerator.GetBytes(64));

static object MapCard(NpgsqlDataReader r) => new
{
    id                 = r.GetGuid(0),
    type               = r.GetString(1),
    sequence           = r.GetInt32(2),
    lane               = (int)r.GetInt16(3),
    titleEs            = r.GetString(4),
    titleEn            = r.GetString(5),
    bodyEs             = r.GetString(6),
    bodyEn             = r.GetString(7),
    linkedEventId      = r.IsDBNull(8)  ? null : r.GetString(8),
    fulfilledByEventId = r.IsDBNull(9)  ? null : r.GetString(9),
    published          = r.GetBoolean(10),
    createdAt          = r.GetDateTime(11),
    updatedAt          = r.GetDateTime(12),
};

// ── Health ────────────────────────────────────────────────────────────────────

app.MapGet("/health", () => Results.Ok(new { status = "ok" }));

// ── Auth ──────────────────────────────────────────────────────────────────────

app.MapPost("/auth/login", async (LoginRequest req, NpgsqlDataSource db, CancellationToken ct) =>
{
    if (!IsValidEmail(req.Email) || string.IsNullOrWhiteSpace(req.Password))
        return Results.Unauthorized();

    var email = req.Email.Trim().ToLowerInvariant();
    await using var conn = await db.OpenConnectionAsync(ct);
    await using var cmd  = conn.CreateCommand();
    cmd.CommandText = "SELECT pwd_hash FROM content.admin_users WHERE email = $1";
    cmd.Parameters.AddWithValue(email);

    var hash = (string?)await cmd.ExecuteScalarAsync(ct);
    if (hash is null || !BCrypt.Net.BCrypt.Verify(req.Password, hash))
        return Results.Unauthorized();

    var access  = MakeAccessToken(email);
    var refresh = MakeRefreshToken();
    refreshTokens[refresh] = email;
    return Results.Ok(new { accessToken = access, refreshToken = refresh });
}).RequireRateLimiting(AdminLoginRateLimit);

// First-run setup — only works when admin_users table is empty
app.MapPost("/auth/setup", async (LoginRequest req, NpgsqlDataSource db, HttpContext http, CancellationToken ct) =>
{
    if (!setupEnabled || (!app.Environment.IsDevelopment() && string.IsNullOrWhiteSpace(setupToken)))
        return Results.NotFound();
    if (!app.Environment.IsDevelopment() && !SecureEquals(http.Request.Headers["X-Setup-Token"].ToString(), setupToken!))
        return Results.Unauthorized();
    if (!IsValidEmail(req.Email))
        return Results.BadRequest(new { error = "Invalid email format." });
    if (!IsStrongPassword(req.Password))
        return Results.BadRequest(new { error = "Password must be at least 12 characters." });

    var email = req.Email.Trim().ToLowerInvariant();
    await using var conn = await db.OpenConnectionAsync(ct);
    await using var countCmd = conn.CreateCommand();
    countCmd.CommandText = "SELECT COUNT(*) FROM content.admin_users";
    var count = (long)(await countCmd.ExecuteScalarAsync(ct))!;
    if (count > 0) return Results.Conflict(new { error = "Admin user already exists." });

    await using var ins = conn.CreateCommand();
    ins.CommandText = "INSERT INTO content.admin_users (email, pwd_hash) VALUES ($1, $2)";
    ins.Parameters.AddWithValue(email);
    ins.Parameters.AddWithValue(BCrypt.Net.BCrypt.HashPassword(req.Password, workFactor: 12));
    await ins.ExecuteNonQueryAsync(ct);
    return Results.Ok(new { message = "Admin user created." });
}).RequireRateLimiting(AdminSetupRateLimit);

app.MapPost("/auth/change-password", async (
    ChangePasswordRequest req,
    NpgsqlDataSource db,
    HttpContext http,
    CancellationToken ct) =>
{
    var email = http.User.FindFirst(System.Security.Claims.ClaimTypes.Email)?.Value;
    if (email is null) return Results.Unauthorized();
    if (string.IsNullOrWhiteSpace(req.CurrentPassword) || !IsStrongPassword(req.NewPassword))
        return Results.BadRequest(new { error = "New password must be at least 12 characters." });

    await using var conn = await db.OpenConnectionAsync(ct);
    await using var sel  = conn.CreateCommand();
    sel.CommandText = "SELECT pwd_hash FROM content.admin_users WHERE email = $1";
    sel.Parameters.AddWithValue(email);
    var hash = (string?)await sel.ExecuteScalarAsync(ct);
    if (hash is null || !BCrypt.Net.BCrypt.Verify(req.CurrentPassword, hash))
        return Results.Problem("Current password incorrect.", statusCode: 400);

    await using var upd = conn.CreateCommand();
    upd.CommandText = "UPDATE content.admin_users SET pwd_hash=$2 WHERE email=$1";
    upd.Parameters.AddWithValue(email);
    upd.Parameters.AddWithValue(BCrypt.Net.BCrypt.HashPassword(req.NewPassword, workFactor: 12));
    await upd.ExecuteNonQueryAsync(ct);
    return Results.NoContent();
}).RequireAuthorization();

app.MapPost("/auth/refresh", (RefreshRequest req) =>
{
    if (!refreshTokens.TryGetValue(req.RefreshToken, out var email))
        return Results.Unauthorized();
    return Results.Ok(new { accessToken = MakeAccessToken(email) });
});

app.MapPost("/auth/logout", (RefreshRequest req) =>
{
    refreshTokens.TryRemove(req.RefreshToken, out _);
    return Results.NoContent();
});

// ── Float cards — read all (admin sees unpublished too) ───────────────────────

app.MapGet("/floats", async (NpgsqlDataSource db, CancellationToken ct) =>
{
    await using var conn = await db.OpenConnectionAsync(ct);
    await using var cmd  = conn.CreateCommand();
    cmd.CommandText = """
        SELECT id, type, sequence, lane,
               title_es, title_en, body_es, body_en,
               linked_event_id, fulfilled_by_event_id,
               published, created_at, updated_at
        FROM content.float_cards
        ORDER BY sequence, lane;
        """;
    var cards = new List<object>();
    await using var reader = await cmd.ExecuteReaderAsync(ct);
    while (await reader.ReadAsync(ct))
        cards.Add(MapCard(reader));
    return Results.Ok(new { floats = cards });
}).RequireAuthorization();

app.MapGet("/floats/{id:guid}", async (Guid id, NpgsqlDataSource db, CancellationToken ct) =>
{
    await using var conn = await db.OpenConnectionAsync(ct);
    await using var cmd  = conn.CreateCommand();
    cmd.CommandText = """
        SELECT id, type, sequence, lane,
               title_es, title_en, body_es, body_en,
               linked_event_id, fulfilled_by_event_id,
               published, created_at, updated_at
        FROM content.float_cards WHERE id = $1;
        """;
    cmd.Parameters.AddWithValue(id);
    await using var reader = await cmd.ExecuteReaderAsync(ct);
    return await reader.ReadAsync(ct) ? Results.Ok(MapCard(reader)) : Results.NotFound();
}).RequireAuthorization();

// ── Float cards — create ──────────────────────────────────────────────────────

app.MapPost("/floats", async (FloatCardInput inp, NpgsqlDataSource db, CancellationToken ct) =>
{
    await using var conn = await db.OpenConnectionAsync(ct);
    await using var cmd  = conn.CreateCommand();
    cmd.CommandText = """
        INSERT INTO content.float_cards
            (type, sequence, lane, title_es, title_en, body_es, body_en,
             linked_event_id, fulfilled_by_event_id, published)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        RETURNING id;
        """;
    cmd.Parameters.AddWithValue(inp.Type);
    cmd.Parameters.AddWithValue(inp.Sequence);
    cmd.Parameters.AddWithValue((short)inp.Lane);
    cmd.Parameters.AddWithValue(inp.TitleEs);
    cmd.Parameters.AddWithValue(inp.TitleEn);
    cmd.Parameters.AddWithValue(inp.BodyEs);
    cmd.Parameters.AddWithValue(inp.BodyEn);
    cmd.Parameters.AddWithValue((object?)inp.LinkedEventId      ?? DBNull.Value);
    cmd.Parameters.AddWithValue((object?)inp.FulfilledByEventId ?? DBNull.Value);
    cmd.Parameters.AddWithValue(inp.Published);
    var newId = (Guid)(await cmd.ExecuteScalarAsync(ct))!;
    return Results.Created($"/floats/{newId}", new { id = newId });
}).RequireAuthorization();

// ── Float cards — update ──────────────────────────────────────────────────────

app.MapPut("/floats/{id:guid}", async (Guid id, FloatCardInput inp, NpgsqlDataSource db, CancellationToken ct) =>
{
    await using var conn = await db.OpenConnectionAsync(ct);
    await using var cmd  = conn.CreateCommand();
    cmd.CommandText = """
        UPDATE content.float_cards SET
            type=$2, sequence=$3, lane=$4,
            title_es=$5, title_en=$6, body_es=$7, body_en=$8,
            linked_event_id=$9, fulfilled_by_event_id=$10, published=$11
        WHERE id=$1;
        """;
    cmd.Parameters.AddWithValue(id);
    cmd.Parameters.AddWithValue(inp.Type);
    cmd.Parameters.AddWithValue(inp.Sequence);
    cmd.Parameters.AddWithValue((short)inp.Lane);
    cmd.Parameters.AddWithValue(inp.TitleEs);
    cmd.Parameters.AddWithValue(inp.TitleEn);
    cmd.Parameters.AddWithValue(inp.BodyEs);
    cmd.Parameters.AddWithValue(inp.BodyEn);
    cmd.Parameters.AddWithValue((object?)inp.LinkedEventId      ?? DBNull.Value);
    cmd.Parameters.AddWithValue((object?)inp.FulfilledByEventId ?? DBNull.Value);
    cmd.Parameters.AddWithValue(inp.Published);
    var rows = await cmd.ExecuteNonQueryAsync(ct);
    return rows == 0 ? Results.NotFound() : Results.NoContent();
}).RequireAuthorization();

// ── Float cards — delete ──────────────────────────────────────────────────────

app.MapDelete("/floats/{id:guid}", async (Guid id, NpgsqlDataSource db, CancellationToken ct) =>
{
    await using var conn = await db.OpenConnectionAsync(ct);
    await using var cmd  = conn.CreateCommand();
    cmd.CommandText = "DELETE FROM content.float_cards WHERE id=$1";
    cmd.Parameters.AddWithValue(id);
    var rows = await cmd.ExecuteNonQueryAsync(ct);
    return rows == 0 ? Results.NotFound() : Results.NoContent();
}).RequireAuthorization();

// ── Float cards — publish / unpublish ─────────────────────────────────────────

app.MapPatch("/floats/{id:guid}/publish", async (Guid id, NpgsqlDataSource db, CancellationToken ct) =>
{
    await using var conn = await db.OpenConnectionAsync(ct);
    await using var cmd  = conn.CreateCommand();
    cmd.CommandText = "UPDATE content.float_cards SET published=true WHERE id=$1";
    cmd.Parameters.AddWithValue(id);
    var rows = await cmd.ExecuteNonQueryAsync(ct);
    return rows == 0 ? Results.NotFound() : Results.NoContent();
}).RequireAuthorization();

app.MapPatch("/floats/{id:guid}/unpublish", async (Guid id, NpgsqlDataSource db, CancellationToken ct) =>
{
    await using var conn = await db.OpenConnectionAsync(ct);
    await using var cmd  = conn.CreateCommand();
    cmd.CommandText = "UPDATE content.float_cards SET published=false WHERE id=$1";
    cmd.Parameters.AddWithValue(id);
    var rows = await cmd.ExecuteNonQueryAsync(ct);
    return rows == 0 ? Results.NotFound() : Results.NoContent();
}).RequireAuthorization();

// ── URL unfurl ────────────────────────────────────────────────────────────────

app.MapPost("/unfurl", async (
    UnfurlRequest req,
    NpgsqlDataSource db,
    IHttpClientFactory httpFactory,
    CancellationToken ct) =>
{
    if (!TryNormalizePublicHttpUrl(req.Url, out var requestedUrl, out var error))
        return Results.BadRequest(new { error });

    var normalizedUrl = requestedUrl.ToString();
    await using var conn = await db.OpenConnectionAsync(ct);

    // Return cached result if available
    await using var check = conn.CreateCommand();
    check.CommandText = """
        SELECT title, description, image_url, site_name
        FROM content.url_unfurls WHERE url=$1;
        """;
    check.Parameters.AddWithValue(normalizedUrl);
    await using var cr = await check.ExecuteReaderAsync(ct);
    if (await cr.ReadAsync(ct))
    {
        return Results.Ok(new
        {
            url         = normalizedUrl,
            title       = cr.IsDBNull(0) ? null : cr.GetString(0),
            description = cr.IsDBNull(1) ? null : cr.GetString(1),
            imageUrl    = cr.IsDBNull(2) ? null : cr.GetString(2),
            siteName    = cr.IsDBNull(3) ? null : cr.GetString(3),
        });
    }
    await cr.DisposeAsync();

    // Fetch and parse OG metadata
    var doc = await FetchPublicHtmlAsync(httpFactory.CreateClient("unfurl"), requestedUrl, ct);
    if (doc is null)
        return Results.Problem("Could not fetch URL", statusCode: 502);

    string? Meta(string prop) =>
        doc.DocumentNode
           .SelectSingleNode($"//meta[@property='{prop}']")
           ?.GetAttributeValue("content", null)
        ?? doc.DocumentNode
              .SelectSingleNode($"//meta[@name='{prop}']")
              ?.GetAttributeValue("content", null);

    var title       = Meta("og:title")       ?? doc.DocumentNode.SelectSingleNode("//title")?.InnerText?.Trim();
    var description = Meta("og:description") ?? Meta("description");
    var imageUrl    = Meta("og:image");
    var siteName    = Meta("og:site_name");

    await using var ins = conn.CreateCommand();
    ins.CommandText = """
        INSERT INTO content.url_unfurls (url, title, description, image_url, site_name)
        VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT (url) DO UPDATE
        SET title=$2, description=$3, image_url=$4, site_name=$5, fetched_at=now();
        """;
    ins.Parameters.AddWithValue(normalizedUrl);
    ins.Parameters.AddWithValue((object?)title       ?? DBNull.Value);
    ins.Parameters.AddWithValue((object?)description ?? DBNull.Value);
    ins.Parameters.AddWithValue((object?)imageUrl    ?? DBNull.Value);
    ins.Parameters.AddWithValue((object?)siteName    ?? DBNull.Value);
    await ins.ExecuteNonQueryAsync(ct);

    return Results.Ok(new { url = normalizedUrl, title, description, imageUrl, siteName });
}).RequireAuthorization().RequireRateLimiting(AdminUnfurlRateLimit);

static string[] ParseCsv(string? value) =>
    string.IsNullOrWhiteSpace(value)
        ? []
        : value.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

static string GetClientKey(HttpContext http) =>
    http.Connection.RemoteIpAddress?.ToString() ?? "unknown";

static bool IsValidEmail(string? email)
{
    if (string.IsNullOrWhiteSpace(email) || email.Length > 254)
        return false;
    try
    {
        var addr = new System.Net.Mail.MailAddress(email.Trim());
        return addr.Address == email.Trim();
    }
    catch
    {
        return false;
    }
}

static bool IsStrongPassword(string? password) =>
    !string.IsNullOrWhiteSpace(password) && password.Length >= 12;

static bool SecureEquals(string left, string right)
{
    var leftHash = SHA256.HashData(Encoding.UTF8.GetBytes(left));
    var rightHash = SHA256.HashData(Encoding.UTF8.GetBytes(right));
    return CryptographicOperations.FixedTimeEquals(leftHash, rightHash);
}

static bool TryNormalizePublicHttpUrl(string rawUrl, out Uri uri, out string error)
{
    uri = null!;
    error = "url must be an absolute http or https URL";

    if (string.IsNullOrWhiteSpace(rawUrl) || rawUrl.Length > 2048)
        return false;
    if (!Uri.TryCreate(rawUrl.Trim(), UriKind.Absolute, out var parsed))
        return false;
    if (parsed.Scheme is not ("http" or "https"))
        return false;
    if (!parsed.IsDefaultPort && parsed.Port is not (80 or 443))
    {
        error = "url port must be 80 or 443";
        return false;
    }
    if (!string.IsNullOrEmpty(parsed.UserInfo))
    {
        error = "url credentials are not allowed";
        return false;
    }

    uri = new UriBuilder(parsed) { Fragment = "" }.Uri;
    return true;
}

static async Task<HtmlDocument?> FetchPublicHtmlAsync(HttpClient client, Uri startUrl, CancellationToken ct)
{
    var currentUrl = startUrl;
    for (var redirects = 0; redirects <= MaxUnfurlRedirects; redirects++)
    {
        if (!await IsPublicHttpUriAsync(currentUrl, ct))
            return null;

        using var request = new HttpRequestMessage(HttpMethod.Get, currentUrl);
        using var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ct);

        if (IsRedirect(response.StatusCode))
        {
            if (redirects == MaxUnfurlRedirects || response.Headers.Location is null)
                return null;
            var nextUrl = response.Headers.Location.IsAbsoluteUri
                ? response.Headers.Location
                : new Uri(currentUrl, response.Headers.Location);
            if (!TryNormalizePublicHttpUrl(nextUrl.ToString(), out currentUrl, out _))
                return null;
            continue;
        }

        if (!response.IsSuccessStatusCode)
            return null;

        var mediaType = response.Content.Headers.ContentType?.MediaType;
        if (mediaType is not null &&
            !mediaType.Contains("html", StringComparison.OrdinalIgnoreCase) &&
            !mediaType.Equals("text/plain", StringComparison.OrdinalIgnoreCase))
            return null;

        var contentLength = response.Content.Headers.ContentLength;
        if (contentLength.HasValue && contentLength.Value > MaxUnfurlBytes)
            return null;

        using var stream = await response.Content.ReadAsStreamAsync(ct);
        var bytes = await ReadLimitedAsync(stream, MaxUnfurlBytes, ct);
        if (bytes is null)
            return null;

        var doc = new HtmlDocument();
        doc.LoadHtml(ResolveEncoding(response.Content.Headers.ContentType?.CharSet).GetString(bytes));
        return doc;
    }

    return null;
}

static bool IsRedirect(HttpStatusCode statusCode) =>
    (int)statusCode is >= 300 and <= 399;

static async Task<bool> IsPublicHttpUriAsync(Uri uri, CancellationToken ct)
{
    if (uri.Scheme is not ("http" or "https"))
        return false;

    if (IPAddress.TryParse(uri.Host, out var ip))
        return IsPublicIp(ip);

    IPAddress[] addresses;
    try
    {
        addresses = await Dns.GetHostAddressesAsync(uri.Host, ct);
    }
    catch (SocketException)
    {
        return false;
    }

    return addresses.Length > 0 && addresses.All(IsPublicIp);
}

static bool IsPublicIp(IPAddress ip)
{
    if (ip.IsIPv4MappedToIPv6)
        ip = ip.MapToIPv4();
    if (IPAddress.IsLoopback(ip))
        return false;

    if (ip.AddressFamily == AddressFamily.InterNetwork)
    {
        var bytes = ip.GetAddressBytes();
        if (bytes[0] is 0 or 10 or 127 || bytes[0] >= 224)
            return false;
        if (bytes[0] == 100 && bytes[1] is >= 64 and <= 127)
            return false;
        if (bytes[0] == 169 && bytes[1] == 254)
            return false;
        if (bytes[0] == 172 && bytes[1] is >= 16 and <= 31)
            return false;
        if (bytes[0] == 192 && bytes[1] == 168)
            return false;
        if (bytes[0] == 198 && bytes[1] is 18 or 19)
            return false;
        return true;
    }

    if (ip.AddressFamily == AddressFamily.InterNetworkV6)
    {
        if (ip.Equals(IPAddress.IPv6Any) || ip.Equals(IPAddress.IPv6None) ||
            ip.IsIPv6LinkLocal || ip.IsIPv6SiteLocal || ip.IsIPv6Multicast)
            return false;
        var bytes = ip.GetAddressBytes();
        if ((bytes[0] & 0xfe) == 0xfc)
            return false;
        return true;
    }

    return false;
}

static async Task<byte[]?> ReadLimitedAsync(Stream stream, int maxBytes, CancellationToken ct)
{
    var buffer = new byte[8192];
    using var memory = new MemoryStream();
    while (true)
    {
        var read = await stream.ReadAsync(buffer.AsMemory(0, buffer.Length), ct);
        if (read == 0)
            break;
        if (memory.Length + read > maxBytes)
            return null;
        await memory.WriteAsync(buffer.AsMemory(0, read), ct);
    }
    return memory.ToArray();
}

static Encoding ResolveEncoding(string? charset)
{
    if (string.IsNullOrWhiteSpace(charset))
        return Encoding.UTF8;
    try
    {
        return Encoding.GetEncoding(charset);
    }
    catch
    {
        return Encoding.UTF8;
    }
}

app.Run("http://+:5083");

// ── DTOs ──────────────────────────────────────────────────────────────────────

record LoginRequest(string Email, string Password);
record ChangePasswordRequest(string CurrentPassword, string NewPassword);
record RefreshRequest(string RefreshToken);
record UnfurlRequest(string Url);
record FloatCardInput(
    string  Type,
    int     Sequence,
    int     Lane,
    string  TitleEs,
    string  TitleEn,
    string  BodyEs,
    string  BodyEn,
    string? LinkedEventId,
    string? FulfilledByEventId,
    bool    Published);
