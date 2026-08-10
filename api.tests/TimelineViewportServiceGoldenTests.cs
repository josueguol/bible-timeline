using System.Text.Json;
using BibleTimeline.Api.Infrastructure;
using BibleTimeline.Api.Models;
using BibleTimeline.Api.Options;
using BibleTimeline.Api.Services;
using Microsoft.Extensions.Options;
using MsOptions = Microsoft.Extensions.Options.Options;
using Npgsql;
using Xunit;

namespace BibleTimeline.Api.Tests;

/// <summary>
/// Golden-parity test for the C# port of <c>scripts/resolve_timeline_viewport.py</c>.
/// Creates an isolated PostgreSQL schema, applies the schema + seed, calls the resolver
/// with the same request that produced <c>timeline_viewport.creation.level2.response.json</c>,
/// and asserts the core fields match.
/// </summary>
public class TimelineViewportServiceGoldenTests : IDisposable
{
    private static string BaseConnStr =>
        Environment.GetEnvironmentVariable("BIBLE_TIMELINE_TEST_DB")
        ?? "Host=localhost;Port=5432;Username=postgres;Password=postgres;Database=postgres";

    private readonly string _schemaName = $"test_{Guid.NewGuid():N}";
    private readonly TimelineViewportService _service;

    public TimelineViewportServiceGoldenTests()
    {
        CreateSchema();
        SeedSchema();

        var connStr = $"{BaseConnStr};Search Path={_schemaName}";
        var options = MsOptions.Create(new BibleTimelineOptions
        {
            ConnectionString = connStr,
            DefaultTimelineId = "bible-history-hierarchy-seed",
            DefaultManifestId = "lectura-expandida-rv60",
        });

        var factory = new NpgsqlConnectionFactory(options);
        _service = new TimelineViewportService(factory, options);
    }

    [Fact]
    public void Resolves_Creation_Level2_To_The_Python_Golden()
    {
        var requestPath  = TestPaths.Combine("resources", "cronologia", "timeline_viewport.creation.level2.request.json");
        var responsePath = TestPaths.Combine("resources", "cronologia", "timeline_viewport.creation.level2.response.json");

        var request = LoadRequest(requestPath);
        var golden  = JsonDocument.Parse(File.ReadAllText(responsePath)).RootElement;

        var actual = _service.Resolve(request);

        Assert.Equal(golden.GetProperty("timelineId").GetString(), actual.TimelineId);

        var goldZoom = golden.GetProperty("zoomLevel");
        Assert.Equal(goldZoom.GetProperty("level").GetInt32(), actual.ZoomLevel.Level);
        Assert.Equal(goldZoom.GetProperty("label").GetString(), actual.ZoomLevel.Label);
        Assert.Equal(goldZoom.GetProperty("targetVisibleEvents").GetInt32(), actual.ZoomLevel.TargetVisibleEvents);

        var goldFocus = golden.GetProperty("focus");
        Assert.Equal(goldFocus.GetProperty("resolvedFocusSequence").GetInt32(), actual.Focus.ResolvedFocusSequence);
        Assert.Equal(goldFocus.GetProperty("focusedEventId").GetString(), actual.Focus.FocusedEventId);
        var goldPath = goldFocus.GetProperty("focusPath").EnumerateArray().Select(e => e.GetString()).ToArray();
        Assert.Equal(goldPath, actual.Focus.FocusPath.ToArray());

        var goldEvents = golden.GetProperty("visibleEvents").EnumerateArray().ToArray();
        Assert.Equal(goldEvents.Length, actual.VisibleEvents.Count);
        for (var i = 0; i < goldEvents.Length; i++)
        {
            var expected = goldEvents[i];
            var got = actual.VisibleEvents[i];
            Assert.Equal(expected.GetProperty("id").GetString(), got.Id);
            Assert.Equal(expected.GetProperty("state").GetString(), got.State);
            Assert.Equal(expected.GetProperty("isFocused").GetBoolean(), got.IsFocused);
            Assert.Equal(expected.GetProperty("isFocusAncestor").GetBoolean(), got.IsFocusAncestor);
            Assert.Equal(expected.GetProperty("displayOrder").GetInt32(), got.DisplayOrder);
        }

        var goldStats = golden.GetProperty("stats");
        Assert.Equal(goldStats.GetProperty("visibleCount").GetInt32(), actual.Stats.VisibleCount);
        Assert.Equal(goldStats.GetProperty("targetVisibleEvents").GetInt32(), actual.Stats.TargetVisibleEvents);
        Assert.Equal(goldStats.GetProperty("viewportEventBudget").GetInt32(), actual.Stats.ViewportEventBudget);
    }

    private static ViewportRequest LoadRequest(string path)
    {
        var doc = JsonDocument.Parse(File.ReadAllText(path)).RootElement;
        return new ViewportRequest
        {
            TimelineId = doc.GetProperty("timelineId").GetString() ?? string.Empty,
            ZoomFactor = doc.GetProperty("zoomFactor").GetDouble(),
            FocusSequence = doc.TryGetProperty("focusSequence", out var fs) && fs.ValueKind == JsonValueKind.Number ? fs.GetInt32() : null,
            FocusRef = doc.TryGetProperty("focusRef", out var fr) && fr.ValueKind == JsonValueKind.String ? fr.GetString() : null,
            FocusEventId = doc.TryGetProperty("focusEventId", out var fe) && fe.ValueKind == JsonValueKind.String ? fe.GetString() : null,
            ViewportEventBudget = doc.TryGetProperty("viewportEventBudget", out var b) && b.ValueKind == JsonValueKind.Number ? b.GetInt32() : null,
            IncludeAncestors = doc.TryGetProperty("includeAncestors", out var ia) && ia.ValueKind != JsonValueKind.Null ? ia.GetBoolean() : null,
        };
    }

    private void CreateSchema()
    {
        using var conn = new NpgsqlConnection(BaseConnStr);
        conn.Open();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = $"CREATE SCHEMA \"{_schemaName}\"";
        cmd.ExecuteNonQuery();
    }

    private void SeedSchema()
    {
        var schemaPath = TestPaths.Combine("resources", "sql", "bible_timeline_schema.sql");
        var seedPath   = TestPaths.Combine("resources", "sql", "bible_timeline_bundle.rv60.seed.sql");
        var connStr    = $"{BaseConnStr};Search Path={_schemaName}";

        using var conn = new NpgsqlConnection(connStr);
        conn.Open();
        ExecuteScript(conn, File.ReadAllText(schemaPath));
        ExecuteScript(conn, File.ReadAllText(seedPath));
    }

    private static void ExecuteScript(NpgsqlConnection connection, string script)
    {
        using var cmd = connection.CreateCommand();
        cmd.CommandText = script;
        cmd.ExecuteNonQuery();
    }

    public void Dispose()
    {
        try
        {
            using var conn = new NpgsqlConnection(BaseConnStr);
            conn.Open();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = $"DROP SCHEMA IF EXISTS \"{_schemaName}\" CASCADE";
            cmd.ExecuteNonQuery();
        }
        catch { /* best effort */ }
    }
}
