using BibleTimeline.Api.Infrastructure;
using BibleTimeline.Api.Options;
using BibleTimeline.Api.Services;
using Microsoft.Extensions.Options;
using MsOptions = Microsoft.Extensions.Options.Options;
using Npgsql;
using Xunit;

namespace BibleTimeline.Api.Tests;

/// <summary>
/// Smoke tests for the task 5 services. Creates an isolated PostgreSQL schema,
/// applies schema + rv60 bundle, and exercises the three read services against real rows.
/// </summary>
public class BibleEndpointsSmokeTests : IDisposable
{
    private static string BaseConnStr =>
        Environment.GetEnvironmentVariable("BIBLE_TIMELINE_TEST_DB")
        ?? "Host=localhost;Port=5432;Username=postgres;Password=postgres;Database=postgres";

    private readonly string _schemaName = $"test_{Guid.NewGuid():N}";
    private readonly BibleReadingService _bibleReader;
    private readonly SearchService _search;
    private readonly EventDetailService _eventDetail;
    private readonly StrongService _strongService;

    public BibleEndpointsSmokeTests()
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

        _bibleReader = new BibleReadingService(factory, options);
        _search = new SearchService(factory, options);
        _eventDetail = new EventDetailService(factory);
        _strongService = new StrongService(factory);
    }

    [Fact]
    public void ListVersions_Returns_RV60_As_Primary()
    {
        var result = _bibleReader.ListVersions();
        Assert.NotEmpty(result.Versions);
        var primary = result.Versions.FirstOrDefault(v => v.IsPrimary);
        Assert.NotNull(primary);
        Assert.Equal("RV60", primary!.Code);
        Assert.True(primary.VerseCount.GetValueOrDefault() > 30000, "expected RV60 to have ≳31k verses in the seed");
        Assert.Equal("es", primary.Language);
    }

    [Fact]
    public void GetRange_By_Ref_Returns_Genesis_Opening()
    {
        var result = _bibleReader.GetRange(
            versionCodes: new[] { "RV60" },
            fromSequence: null,
            toSequence: null,
            fromRef: "Génesis 1:1",
            toRef: "Génesis 1:3",
            manifestId: null,
            limit: 100);

        Assert.Equal("lectura-expandida-rv60", result.ManifestId);
        Assert.Equal(new[] { "RV60" }, result.Versions);
        Assert.Equal(3, result.Rows.Count);
        Assert.Equal("Génesis 1:1", result.Rows[0].Ref);
        Assert.Equal("Génesis", result.Rows[0].Book);
        Assert.Equal(1, result.Rows[0].Chapter);
        Assert.Equal(1, result.Rows[0].Verse);
        Assert.Contains("RV60", result.Rows[0].Texts.Keys);
        Assert.False(string.IsNullOrWhiteSpace(result.Rows[0].Texts["RV60"]));
    }

    [Fact]
    public void GetRange_By_Sequence_Clamps_To_Limit()
    {
        var result = _bibleReader.GetRange(
            versionCodes: new[] { "RV60" },
            fromSequence: 1,
            toSequence: 500,
            fromRef: null,
            toRef: null,
            manifestId: null,
            limit: 25);
        Assert.Equal(25, result.Rows.Count);
        Assert.Equal(1, result.Range.FromSequence);
        Assert.Equal(25, result.Range.ToSequence);
    }

    [Fact]
    public void GetRange_With_Strong_Returns_Word_Segments_And_Lexicon()
    {
        var result = _bibleReader.GetRange(
            versionCodes: new[] { "HEB_OSHB" },
            fromSequence: null,
            toSequence: null,
            fromRef: "Génesis 1:1",
            toRef: "Génesis 1:1",
            manifestId: null,
            limit: 10,
            includeStrong: true);

        var row = Assert.Single(result.Rows);
        Assert.NotNull(row.Segments);
        Assert.True(row.Segments!.ContainsKey("HEB_OSHB"));
        Assert.Contains(row.Segments["HEB_OSHB"], segment =>
            segment.Text == "בְּרֵאשִׁית"
            && segment.Strongs.Any(strong => strong.StrongNumber == "H7225"));
        Assert.NotNull(result.Lexicon);
        Assert.True(result.Lexicon!.ContainsKey("H7225"));
        Assert.Equal("בְּרֵאשִׁית", result.Lexicon["H7225"].Lemma);
        Assert.Equal("principio", result.Lexicon["H7225"].Definition);
        Assert.Equal("es", result.Lexicon["H7225"].DefinitionLanguage);
        Assert.Equal("reviewed", result.Lexicon["H7225"].TranslationStatus);
    }

    [Fact]
    public void StrongService_Normalizes_Zero_Padded_Numbers()
    {
        var entry = _strongService.Get("H07225");
        Assert.NotNull(entry);
        Assert.Equal("H7225", entry!.StrongNumber);
        Assert.Equal("principio", entry.Definition);
        Assert.Equal("es", entry.DefinitionLanguage);
    }

    [Fact]
    public void StrongService_Returns_English_When_Requested()
    {
        var entry = _strongService.Get("H07225", "en");
        Assert.NotNull(entry);
        Assert.Equal("H7225", entry!.StrongNumber);
        Assert.Equal("beginning", entry.Definition);
        Assert.Equal("en", entry.DefinitionLanguage);
        Assert.Equal("source", entry.TranslationStatus);
    }

    [Fact]
    public void Search_Reference_Parses_Genesis_1_1()
    {
        var result = _search.Search("Génesis 1:1", versionCode: null, timelineId: null, categories: null, limit: 5);
        Assert.Contains(result.Results, r => r.Category == "reference" && r.Label == "Génesis 1:1");
    }

    [Fact]
    public void Search_Text_Finds_Principio_In_RV60()
    {
        var result = _search.Search("principio creó", versionCode: "RV60", timelineId: null,
            categories: new[] { "text" }, limit: 5);
        Assert.NotEmpty(result.Results);
        Assert.All(result.Results, r => Assert.Equal("text", r.Category));
        Assert.Contains(result.Results, r => r.Label == "Génesis 1:1");
    }

    [Fact]
    public void Search_Event_Filters_By_Category()
    {
        var result = _search.Search("creación", versionCode: null, timelineId: null,
            categories: new[] { "event" }, limit: 10);
        Assert.All(result.Results, r => Assert.Equal("event", r.Category));
    }

    [Fact]
    public void EventDetail_Returns_Null_For_Unknown_Id()
    {
        var response = _eventDetail.Get("bible-history-hierarchy-seed", "does-not-exist-xyz");
        Assert.Null(response);
    }

    [Fact]
    public void EventDetail_Returns_Root_Creation_Event()
    {
        var response = _eventDetail.Get("bible-history-hierarchy-seed", "creation");
        Assert.NotNull(response);
        Assert.Equal("bible-history-hierarchy-seed", response!.TimelineId);
        Assert.Equal("creation", response.Event.Id);
        Assert.Null(response.Event.ParentId);
        Assert.Empty(response.Ancestors);
        Assert.True(response.ChildrenSummary.Total > 0, "creation is expected to have children in the seed");
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
        ExecuteScript(conn, StrongFixtureSql);
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

    private const string StrongFixtureSql = """
        INSERT INTO bible_versions (version_id, code, title, language, source_path) VALUES
        ('heb_oshb', 'HEB_OSHB', 'Open Scriptures Hebrew Bible', 'heb', 'resources/biblias/HEB_OSHB.xml')
        ON CONFLICT (version_id) DO UPDATE SET
          code = EXCLUDED.code,
          title = EXCLUDED.title,
          language = EXCLUDED.language,
          source_path = EXCLUDED.source_path;

        INSERT INTO bible_verses (version_id, ref, book, chapter, verse, text) VALUES
        ('heb_oshb', 'Génesis 1:1', 'Génesis', 1, 1, 'בְּרֵאשִׁית בָּרָא אֱלֹהִים אֵת הַשָּׁמַיִם וְאֵת הָאָרֶץ ׃')
        ON CONFLICT (version_id, ref) DO UPDATE SET text = EXCLUDED.text;

        INSERT INTO strong_entries
          (strong_number, language, lemma, transliteration, pronunciation, definition, derivation, kjv_definition, source)
        VALUES
          ('H7225', 'hebrew', 'בְּרֵאשִׁית', 'rêshîyth', 'ray-sheeth', 'beginning', '', 'beginning', 'fixture'),
          ('H1254', 'hebrew', 'בָּרָא', 'bârâʼ', 'baw-raw', 'to create', '', 'create', 'fixture')
        ON CONFLICT (strong_number) DO UPDATE SET
          language = EXCLUDED.language,
          lemma = EXCLUDED.lemma,
          transliteration = EXCLUDED.transliteration,
          pronunciation = EXCLUDED.pronunciation,
          definition = EXCLUDED.definition,
          derivation = EXCLUDED.derivation,
          kjv_definition = EXCLUDED.kjv_definition,
          source = EXCLUDED.source;

        INSERT INTO strong_entry_translations
          (strong_number, language_code, definition, derivation, kjv_definition, translation_status, source)
        VALUES
          ('H7225', 'es', 'principio', '', 'principio', 'reviewed', 'fixture'),
          ('H1254', 'es', 'crear', '', 'crear', 'reviewed', 'fixture')
        ON CONFLICT (strong_number, language_code) DO UPDATE SET
          definition = EXCLUDED.definition,
          derivation = EXCLUDED.derivation,
          kjv_definition = EXCLUDED.kjv_definition,
          translation_status = EXCLUDED.translation_status,
          source = EXCLUDED.source;

        INSERT INTO bible_verse_segments (version_id, ref, position, text) VALUES
          ('heb_oshb', 'Génesis 1:1', 1, 'בְּרֵאשִׁית'),
          ('heb_oshb', 'Génesis 1:1', 2, 'בָּרָא'),
          ('heb_oshb', 'Génesis 1:1', 3, '׃')
        ON CONFLICT (version_id, ref, position) DO UPDATE SET text = EXCLUDED.text;

        INSERT INTO bible_verse_segment_strongs
          (version_id, ref, position, sequence, strong_number, strong_raw)
        VALUES
          ('heb_oshb', 'Génesis 1:1', 1, 1, 'H7225', 'H07225'),
          ('heb_oshb', 'Génesis 1:1', 2, 1, 'H1254', 'H01254')
        ON CONFLICT (version_id, ref, position, sequence) DO UPDATE SET
          strong_number = EXCLUDED.strong_number,
          strong_raw = EXCLUDED.strong_raw;
        """;
}
