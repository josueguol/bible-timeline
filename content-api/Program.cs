using Npgsql;

var builder = WebApplication.CreateBuilder(args);

var connStr = builder.Configuration.GetConnectionString("Default")
    ?? throw new InvalidOperationException("Missing ConnectionStrings:Default");
var corsAllowedOrigins = ParseCsv(builder.Configuration["Cors:AllowedOrigins"]);

builder.Services.AddSingleton(_ => NpgsqlDataSource.Create(connStr));

builder.Services.AddCors(o => o.AddDefaultPolicy(p =>
{
    if (builder.Environment.IsDevelopment() && corsAllowedOrigins.Length == 0)
        p.AllowAnyOrigin().AllowAnyMethod().AllowAnyHeader();
    else if (corsAllowedOrigins.Length > 0)
        p.WithOrigins(corsAllowedOrigins).AllowAnyMethod().AllowAnyHeader();
}));

var app = builder.Build();
app.UseCors();

// ── Health ────────────────────────────────────────────────────────────────────

app.MapGet("/health", () => Results.Ok(new { status = "ok" }));

// ── GET /floats ───────────────────────────────────────────────────────────────

app.MapGet("/floats", async (
    NpgsqlDataSource db,
    string?  type    = null,
    int?     seqFrom = null,
    int?     seqTo   = null,
    CancellationToken ct = default) =>
{
    await using var conn = await db.OpenConnectionAsync(ct);
    await using var cmd  = conn.CreateCommand();

    var conditions = new List<string> { "published = true" };
    if (type    is not null) { conditions.Add($"type = ${cmd.Parameters.Count + 1}");     cmd.Parameters.AddWithValue(type); }
    if (seqFrom is not null) { conditions.Add($"sequence >= ${cmd.Parameters.Count + 1}"); cmd.Parameters.AddWithValue(seqFrom.Value); }
    if (seqTo   is not null) { conditions.Add($"sequence <= ${cmd.Parameters.Count + 1}"); cmd.Parameters.AddWithValue(seqTo.Value); }

    cmd.CommandText = $"""
        SELECT id, type, sequence, lane,
               title_es, title_en, body_es, body_en,
               linked_event_id, fulfilled_by_event_id
        FROM content.float_cards
        WHERE {string.Join(" AND ", conditions)}
        ORDER BY sequence, lane;
        """;

    var cards = new List<object>();
    await using var reader = await cmd.ExecuteReaderAsync(ct);
    while (await reader.ReadAsync(ct))
    {
        cards.Add(new
        {
            id                 = reader.GetGuid(0),
            type               = reader.GetString(1),
            sequence           = reader.GetInt32(2),
            lane               = (int)reader.GetInt16(3),
            titleEs            = reader.GetString(4),
            titleEn            = reader.GetString(5),
            bodyEs             = reader.GetString(6),
            bodyEn             = reader.GetString(7),
            linkedEventId      = reader.IsDBNull(8) ? null : reader.GetString(8),
            fulfilledByEventId = reader.IsDBNull(9) ? null : reader.GetString(9),
        });
    }

    return Results.Ok(new { floats = cards });
});

// ── GET /floats/{id} ──────────────────────────────────────────────────────────

app.MapGet("/floats/{id:guid}", async (Guid id, NpgsqlDataSource db, CancellationToken ct) =>
{
    await using var conn = await db.OpenConnectionAsync(ct);
    await using var cmd  = conn.CreateCommand();
    cmd.CommandText = """
        SELECT id, type, sequence, lane,
               title_es, title_en, body_es, body_en,
               linked_event_id, fulfilled_by_event_id
        FROM content.float_cards
        WHERE id = $1 AND published = true;
        """;
    cmd.Parameters.AddWithValue(id);
    await using var reader = await cmd.ExecuteReaderAsync(ct);
    if (!await reader.ReadAsync(ct)) return Results.NotFound();
    return Results.Ok(new
    {
        id                 = reader.GetGuid(0),
        type               = reader.GetString(1),
        sequence           = reader.GetInt32(2),
        lane               = (int)reader.GetInt16(3),
        titleEs            = reader.GetString(4),
        titleEn            = reader.GetString(5),
        bodyEs             = reader.GetString(6),
        bodyEn             = reader.GetString(7),
        linkedEventId      = reader.IsDBNull(8) ? null : reader.GetString(8),
        fulfilledByEventId = reader.IsDBNull(9) ? null : reader.GetString(9),
    });
});

static string[] ParseCsv(string? value) =>
    string.IsNullOrWhiteSpace(value)
        ? []
        : value.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

app.Run("http://+:5082");
