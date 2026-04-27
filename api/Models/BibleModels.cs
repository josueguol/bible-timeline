namespace BibleTimeline.Api.Models;

public sealed class BibleVersionDto
{
    public string VersionId { get; init; } = string.Empty;
    public string Code { get; init; } = string.Empty;
    public string Title { get; init; } = string.Empty;
    public string Language { get; init; } = string.Empty;
    public string LanguageFamily { get; init; } = "other";
    public bool IsPrimary { get; init; }
    public int? VerseCount { get; init; }
    public string? SourcePath { get; init; }
}

public sealed class VersionsListResponse
{
    public IReadOnlyList<BibleVersionDto> Versions { get; init; } = Array.Empty<BibleVersionDto>();
}

public sealed class VerseRangeRowDto
{
    public int Sequence { get; init; }
    public string Ref { get; init; } = string.Empty;
    public string Book { get; init; } = string.Empty;
    public int Chapter { get; init; }
    public int Verse { get; init; }

    /// <summary>
    /// Keyed by version code (RV60, NTV, ...). Value is null when that version does not have that verse.
    /// </summary>
    public Dictionary<string, string?> Texts { get; init; } = new();
}

public sealed class VerseRangeDto
{
    public int FromSequence { get; init; }
    public int ToSequence { get; init; }
    public string? FromRef { get; init; }
    public string? ToRef { get; init; }
}

public sealed class VersesRangeResponse
{
    public string ManifestId { get; init; } = string.Empty;
    public IReadOnlyList<string> Versions { get; init; } = Array.Empty<string>();
    public VerseRangeDto Range { get; init; } = new();
    public IReadOnlyList<VerseRangeRowDto> Rows { get; init; } = Array.Empty<VerseRangeRowDto>();
}

public sealed class SearchFocusDto
{
    public string? FocusRef { get; init; }
    public int? FocusSequence { get; init; }
    public string? FocusEventId { get; init; }
}

public sealed class SearchResultDto
{
    public string Category { get; init; } = "text";
    public string Label { get; init; } = string.Empty;
    public string? Description { get; init; }
    public SearchFocusDto Focus { get; init; } = new();
    public double? Score { get; init; }
    public string? Preview { get; init; }
}

public sealed class SearchResponse
{
    public string Query { get; init; } = string.Empty;
    public IReadOnlyList<SearchResultDto> Results { get; init; } = Array.Empty<SearchResultDto>();
}

public sealed class EventDetailSourceDto
{
    public string SourceRef { get; init; } = string.Empty;
    public string SourceType { get; init; } = "scripture";
}

public sealed class EventDetailEventDto
{
    public string Id { get; init; } = string.Empty;
    public string? ParentId { get; init; }
    public int ZoomLevel { get; init; }
    public int Sequence { get; init; }
    public string Title { get; init; } = string.Empty;
    public string StartLabel { get; init; } = string.Empty;
    public string EndLabel { get; init; } = string.Empty;
    public string StartRef { get; init; } = string.Empty;
    public string EndRef { get; init; } = string.Empty;
    public int StartSequence { get; init; }
    public int EndSequence { get; init; }
    public string Summary { get; init; } = string.Empty;
    public int Importance { get; init; }
    public bool Canonical { get; init; }
    public IReadOnlyList<string>? ScriptureRefs { get; init; }
    public IReadOnlyList<EventDetailSourceDto>? Sources { get; init; }
}

public sealed class EventDetailAncestorDto
{
    public string Id { get; init; } = string.Empty;
    public string Title { get; init; } = string.Empty;
    public int ZoomLevel { get; init; }
}

public sealed class ChildrenSummaryDto
{
    public int Total { get; init; }
    public Dictionary<string, int> ByZoomLevel { get; init; } = new();
}

public sealed class EventDetailResponse
{
    public string TimelineId { get; init; } = string.Empty;
    public EventDetailEventDto Event { get; init; } = new();
    public IReadOnlyList<EventDetailAncestorDto> Ancestors { get; init; } = Array.Empty<EventDetailAncestorDto>();
    public ChildrenSummaryDto ChildrenSummary { get; init; } = new();
}
