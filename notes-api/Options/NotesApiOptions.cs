using System.ComponentModel.DataAnnotations;

namespace BibleTimeline.NotesApi.Options;

public sealed class NotesApiOptions
{
    public const string SectionName = "NotesApi";

    [Required]
    public string ConnectionString { get; init; } = "Host=localhost;Port=5432;Username=postgres;Password=postgres;Database=bible_timeline";

    [Required, MinLength(32)]
    public string JwtSecret { get; init; } = string.Empty;

    public string JwtIssuer   { get; init; } = "bible-timeline-notes";
    public string JwtAudience { get; init; } = "bible-timeline-web";

    public int AccessTokenExpiryMinutes { get; init; } = 15;
    public int RefreshTokenExpiryDays   { get; init; } = 7;

    // ── OAuth providers ───────────────────────────────────────────────────────
    public string GoogleClientId    { get; init; } = string.Empty;
    public string FacebookAppId     { get; init; } = string.Empty;
    public string FacebookAppSecret { get; init; } = string.Empty;
    public string TwitterClientId   { get; init; } = string.Empty;
    public string TwitterClientSecret { get; init; } = string.Empty;

    // Absolute URL the browser will land on after Twitter OAuth
    // In dev: http://localhost:5173
    public string FrontendBaseUrl   { get; init; } = "http://localhost:5173";
}
