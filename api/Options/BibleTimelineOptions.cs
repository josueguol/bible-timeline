namespace BibleTimeline.Api.Options;

/// <summary>
/// Bind target for the "BibleTimeline" section in appsettings.json.
/// </summary>
public sealed class BibleTimelineOptions
{
    public const string SectionName = "BibleTimeline";

    public string ConnectionString { get; init; } = "Host=localhost;Port=5432;Username=postgres;Password=postgres;Database=bible_timeline";
    public string SchemaPath { get; init; } = "bible_timeline_schema.sql";
    public string SeedPath { get; init; } = "bible_timeline_bundle.rv60.seed.sql";
    public string DefaultTimelineId { get; init; } = "bible-history-hierarchy-seed";
    public string DefaultManifestId { get; init; } = "lectura-expandida-rv60";
    public bool AutoApplySeedIfMissing { get; init; } = true;
}
