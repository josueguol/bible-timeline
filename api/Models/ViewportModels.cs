using System.Text.Json.Serialization;

namespace BibleTimeline.Api.Models;

/// <summary>
/// Request shape matching <c>docs/contracts/timeline-viewport-request.schema.json</c>.
/// Deserialized from query string via model binding.
/// </summary>
public sealed class ViewportRequest
{
    public string TimelineId { get; init; } = string.Empty;
    public double ZoomFactor { get; init; }
    public int? FocusSequence { get; init; }
    public string? FocusRef { get; init; }
    public string? FocusEventId { get; init; }
    public int? ViewportEventBudget { get; init; }
    public bool? IncludeAncestors { get; init; }
}

public sealed class ZoomLevelDto
{
    public int Level { get; init; }
    public string Label { get; init; } = string.Empty;
    public double MinZoomFactor { get; init; }
    public double MaxZoomFactor { get; init; }
    public int TargetVisibleEvents { get; init; }
    public string Description { get; init; } = string.Empty;
}

public sealed class ViewportFocusDto
{
    public int? RequestedFocusSequence { get; init; }
    public string? RequestedFocusRef { get; init; }
    public string? RequestedFocusEventId { get; init; }
    public int ResolvedFocusSequence { get; init; }
    public string? ResolvedFocusRef { get; init; }
    public string FocusedEventId { get; init; } = string.Empty;
    public IReadOnlyList<string> FocusPath { get; init; } = Array.Empty<string>();
}

public sealed class VisibleEventDto
{
    public string Id { get; init; } = string.Empty;
    public string? ParentId { get; init; }
    public int ZoomLevel { get; init; }
    public int Sequence { get; init; }
    public string Title { get; init; } = string.Empty;
    public string Summary { get; init; } = string.Empty;
    public string StartRef { get; init; } = string.Empty;
    public string EndRef { get; init; } = string.Empty;
    public int StartSequence { get; init; }
    public int EndSequence { get; init; }
    public int Importance { get; init; }
    public bool Canonical { get; init; }
    public string State { get; init; } = "collapsed";
    public bool IsFocused { get; init; }
    public bool IsFocusAncestor { get; init; }
    public IReadOnlyList<string> Path { get; init; } = Array.Empty<string>();
    // Settable: filled after tree traversal so we can number events 1..N in visit order.
    public int DisplayOrder { get; set; }
}

public sealed class ViewportStatsDto
{
    public int VisibleCount { get; init; }
    public int TargetVisibleEvents { get; init; }
    public int ViewportEventBudget { get; init; }
}

public sealed class ViewportResponse
{
    public string TimelineId { get; init; } = string.Empty;
    public ZoomLevelDto ZoomLevel { get; init; } = new();
    public ViewportFocusDto Focus { get; init; } = new();
    public IReadOnlyList<VisibleEventDto> VisibleEvents { get; init; } = Array.Empty<VisibleEventDto>();
    public ViewportStatsDto Stats { get; init; } = new();
}
