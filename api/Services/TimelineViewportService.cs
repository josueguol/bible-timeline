using BibleTimeline.Api.Infrastructure;
using BibleTimeline.Api.Models;
using BibleTimeline.Api.Options;
using Microsoft.Extensions.Options;
using Npgsql;

namespace BibleTimeline.Api.Services;

/// <summary>
/// Port of <c>scripts/resolve_timeline_viewport.py</c>. Reads the hierarchical event tree
/// and navigation metadata from PostgreSQL (tables <c>timeline_events</c>, <c>timeline_zoom_levels</c>,
/// <c>timeline_verse_order</c>) and resolves which events are visible for a given
/// zoomFactor + focus, matching the shape of
/// <c>docs/contracts/timeline-viewport-response.schema.json</c>.
/// </summary>
public sealed class TimelineViewportService
{
    private readonly NpgsqlConnectionFactory _connectionFactory;
    private readonly BibleTimelineOptions _options;

    public TimelineViewportService(
        NpgsqlConnectionFactory connectionFactory,
        IOptions<BibleTimelineOptions> options)
    {
        _connectionFactory = connectionFactory;
        _options = options.Value;
    }

    // --------------------------------------------------------------------
    // Internal tree model (kept separate from the DTO used in the response)
    // --------------------------------------------------------------------
    private sealed class EventNode
    {
        public required string Id { get; init; }
        public string? ParentId { get; init; }
        public required int ZoomLevel { get; init; }
        public required int Sequence { get; init; }
        public required string Title { get; init; }
        public required string Summary { get; init; }
        public required string StartRef { get; init; }
        public required string EndRef { get; init; }
        public required int StartSequence { get; init; }
        public required int EndSequence { get; init; }
        public required int Importance { get; init; }
        public required bool Canonical { get; init; }
        public List<EventNode> Children { get; } = new();
    }

    public ViewportResponse Resolve(ViewportRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.TimelineId))
        {
            throw new ArgumentException("timelineId is required", nameof(request));
        }
        if (request.ZoomFactor < 0 || request.ZoomFactor > 1)
        {
            throw new ArgumentOutOfRangeException(nameof(request), "zoomFactor must be in [0,1]");
        }

        using var connection = _connectionFactory.OpenConnection();

        var zoomLevels = LoadZoomLevels(connection, request.TimelineId);
        if (zoomLevels.Count == 0)
        {
            throw new InvalidOperationException($"Timeline '{request.TimelineId}' has no zoom levels configured");
        }

        var roots = LoadEventTree(connection, request.TimelineId, out var byId);
        if (roots.Count == 0)
        {
            throw new InvalidOperationException($"Timeline '{request.TimelineId}' has no events");
        }

        var refToSequence = LoadVerseOrder(connection, out var sequenceToRef);

        var focusSequence = ResolveFocusSequence(request, byId, refToSequence, roots);
        var zoomLevel = ResolveZoomLevel(zoomLevels, request.ZoomFactor);
        var focusPath = FindFocusPath(roots, focusSequence, zoomLevel.Level);
        var focusedEvent = focusPath[^1];
        var focusPathIds = new HashSet<string>(focusPath.Select(e => e.Id));

        var includeAncestors = request.IncludeAncestors ?? true;
        var visible = BuildVisibleEvents(
            roots,
            focusPathIds,
            focusedEvent.Id,
            zoomLevel.Level,
            includeAncestors);

        var budget = request.ViewportEventBudget ?? zoomLevel.TargetVisibleEvents;

        sequenceToRef.TryGetValue(focusSequence, out var resolvedFocusRef);

        return new ViewportResponse
        {
            TimelineId = request.TimelineId,
            ZoomLevel = zoomLevel,
            Focus = new ViewportFocusDto
            {
                RequestedFocusSequence = request.FocusSequence,
                RequestedFocusRef = request.FocusRef,
                RequestedFocusEventId = request.FocusEventId,
                ResolvedFocusSequence = focusSequence,
                ResolvedFocusRef = resolvedFocusRef,
                FocusedEventId = focusedEvent.Id,
                FocusPath = focusPath.Select(e => e.Id).ToArray(),
            },
            VisibleEvents = visible,
            Stats = new ViewportStatsDto
            {
                VisibleCount = visible.Count,
                TargetVisibleEvents = zoomLevel.TargetVisibleEvents,
                ViewportEventBudget = budget,
            },
        };
    }

    // ---------------------------------------------------------------- data

    private static List<ZoomLevelDto> LoadZoomLevels(NpgsqlConnection connection, string timelineId)
    {
        using var cmd = connection.CreateCommand();
        cmd.CommandText = @"
            SELECT level, label, min_zoom_factor, max_zoom_factor, target_visible_events, description
            FROM timeline_zoom_levels
            WHERE timeline_id = @timelineId
            ORDER BY level;";
        cmd.Parameters.AddWithValue("@timelineId", timelineId);

        var rows = new List<ZoomLevelDto>();
        using var reader = cmd.ExecuteReader();
        while (reader.Read())
        {
            rows.Add(new ZoomLevelDto
            {
                Level = reader.GetInt32(0),
                Label = reader.GetString(1),
                MinZoomFactor = reader.GetDouble(2),
                MaxZoomFactor = reader.GetDouble(3),
                TargetVisibleEvents = reader.GetInt32(4),
                Description = reader.GetString(5),
            });
        }
        return rows;
    }

    private static List<EventNode> LoadEventTree(
        NpgsqlConnection connection,
        string timelineId,
        out Dictionary<string, EventNode> byId)
    {
        using var cmd = connection.CreateCommand();
        cmd.CommandText = @"
            SELECT id, parent_id, zoom_level, sequence, title, summary,
                   start_ref, end_ref, start_sequence, end_sequence, importance, canonical
            FROM timeline_events
            WHERE timeline_id = @timelineId
            ORDER BY zoom_level, sequence;";
        cmd.Parameters.AddWithValue("@timelineId", timelineId);

        byId = new Dictionary<string, EventNode>(StringComparer.Ordinal);
        using var reader = cmd.ExecuteReader();
        while (reader.Read())
        {
            var node = new EventNode
            {
                Id = reader.GetString(0),
                ParentId = reader.IsDBNull(1) ? null : reader.GetString(1),
                ZoomLevel = reader.GetInt32(2),
                Sequence = reader.GetInt32(3),
                Title = reader.GetString(4),
                Summary = reader.GetString(5),
                StartRef = reader.GetString(6),
                EndRef = reader.GetString(7),
                StartSequence = reader.GetInt32(8),
                EndSequence = reader.GetInt32(9),
                Importance = reader.GetInt32(10),
                Canonical = reader.GetBoolean(11),
            };
            byId[node.Id] = node;
        }

        var roots = new List<EventNode>();
        foreach (var node in byId.Values)
        {
            if (node.ParentId is null)
            {
                roots.Add(node);
            }
            else if (byId.TryGetValue(node.ParentId, out var parent))
            {
                parent.Children.Add(node);
            }
        }

        foreach (var node in byId.Values)
        {
            node.Children.Sort((a, b) => a.Sequence.CompareTo(b.Sequence));
        }
        roots.Sort((a, b) => a.Sequence.CompareTo(b.Sequence));
        return roots;
    }

    private Dictionary<string, int> LoadVerseOrder(
        NpgsqlConnection connection,
        out Dictionary<int, string> sequenceToRef)
    {
        var refToSequence = new Dictionary<string, int>(StringComparer.Ordinal);
        sequenceToRef = new Dictionary<int, string>();

        using var cmd = connection.CreateCommand();
        cmd.CommandText = @"
            SELECT sequence, ref
            FROM timeline_verse_order
            WHERE manifest_id = @manifestId
            ORDER BY sequence;";
        cmd.Parameters.AddWithValue("@manifestId", _options.DefaultManifestId);
        using var reader = cmd.ExecuteReader();
        while (reader.Read())
        {
            var sequence = reader.GetInt32(0);
            var refValue = reader.GetString(1);
            refToSequence[refValue] = sequence;
            sequenceToRef[sequence] = refValue;
        }
        return refToSequence;
    }

    // ----------------------------------------------------- resolver algorithm

    private static ZoomLevelDto ResolveZoomLevel(List<ZoomLevelDto> zoomLevels, double zoomFactor)
    {
        foreach (var level in zoomLevels)
        {
            if (zoomFactor >= level.MinZoomFactor && zoomFactor < level.MaxZoomFactor)
            {
                return level;
            }
        }
        return zoomLevels[^1];
    }

    private static int ResolveFocusSequence(
        ViewportRequest request,
        Dictionary<string, EventNode> byId,
        Dictionary<string, int> refToSequence,
        List<EventNode> roots)
    {
        if (request.FocusSequence is int explicitSequence)
        {
            return explicitSequence;
        }
        if (!string.IsNullOrWhiteSpace(request.FocusRef))
        {
            if (!refToSequence.TryGetValue(request.FocusRef!, out var seq))
            {
                throw new ArgumentException($"focusRef not found in verse order: {request.FocusRef}");
            }
            return seq;
        }
        if (!string.IsNullOrWhiteSpace(request.FocusEventId))
        {
            if (!byId.TryGetValue(request.FocusEventId!, out var evt))
            {
                throw new ArgumentException($"focusEventId not found in hierarchy: {request.FocusEventId}");
            }
            return (evt.StartSequence + evt.EndSequence) / 2;
        }
        return roots[0].StartSequence;
    }

    private static List<EventNode> FindFocusPath(
        List<EventNode> roots,
        int focusSequence,
        int maxZoomLevel)
    {
        var path = new List<EventNode>();
        var current = new List<EventNode>(roots);
        current.Sort((a, b) => a.Sequence.CompareTo(b.Sequence));

        while (current.Count > 0)
        {
            var containing = current
                .Where(e => e.StartSequence <= focusSequence && focusSequence <= e.EndSequence)
                .ToList();

            EventNode picked;
            if (containing.Count > 0)
            {
                picked = containing.OrderBy(e => e.ZoomLevel).First();
            }
            else
            {
                picked = current
                    .OrderBy(e => Math.Abs(((e.StartSequence + e.EndSequence) / 2) - focusSequence))
                    .First();
            }
            path.Add(picked);

            if (picked.Children.Count == 0)
            {
                break;
            }
            var nextChildren = picked.Children
                .OrderBy(c => c.Sequence)
                .ToList();
            if (nextChildren[0].ZoomLevel > maxZoomLevel)
            {
                break;
            }
            current = nextChildren;
        }

        return path;
    }

    private static List<VisibleEventDto> BuildVisibleEvents(
        List<EventNode> roots,
        HashSet<string> focusPathIds,
        string focusedEventId,
        int activeZoomLevel,
        bool includeAncestors)
    {
        var visible = new List<VisibleEventDto>();

        void Visit(EventNode node, List<string> pathStack)
        {
            var currentPath = new List<string>(pathStack.Count + 1);
            currentPath.AddRange(pathStack);
            currentPath.Add(node.Id);

            var onFocusPath = focusPathIds.Contains(node.Id);
            var hasChildren = node.Children.Count > 0;
            var expanded = onFocusPath && node.ZoomLevel < activeZoomLevel && hasChildren;

            var isStrictAncestor = onFocusPath && node.Id != focusedEventId && node.ZoomLevel < activeZoomLevel;
            var shouldAppend = includeAncestors || !isStrictAncestor;
            if (shouldAppend)
            {
                visible.Add(new VisibleEventDto
                {
                    Id = node.Id,
                    ParentId = node.ParentId,
                    ZoomLevel = node.ZoomLevel,
                    Sequence = node.Sequence,
                    Title = node.Title,
                    Summary = node.Summary,
                    StartRef = node.StartRef,
                    EndRef = node.EndRef,
                    StartSequence = node.StartSequence,
                    EndSequence = node.EndSequence,
                    Importance = node.Importance,
                    Canonical = node.Canonical,
                    State = expanded ? "expanded" : "collapsed",
                    IsFocused = node.Id == focusedEventId,
                    IsFocusAncestor = onFocusPath && node.Id != focusedEventId,
                    Path = currentPath.ToArray(),
                });
            }

            if (expanded)
            {
                foreach (var child in node.Children.OrderBy(c => c.Sequence))
                {
                    Visit(child, currentPath);
                }
            }
        }

        foreach (var root in roots.OrderBy(r => r.Sequence))
        {
            Visit(root, new List<string>());
        }

        for (int i = 0; i < visible.Count; i++)
        {
            visible[i].DisplayOrder = i + 1;
        }
        return visible;
    }
}
