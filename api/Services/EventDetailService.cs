using BibleTimeline.Api.Infrastructure;
using BibleTimeline.Api.Models;
using Npgsql;

namespace BibleTimeline.Api.Services;

/// <summary>
/// Reads a single event with its ancestor chain, children summary, and sources
/// from <c>timeline_events</c> + <c>timeline_event_sources</c>, matching
/// <c>docs/contracts/event-detail-response.schema.json</c>.
/// </summary>
public sealed class EventDetailService
{
    private readonly NpgsqlConnectionFactory _connectionFactory;

    public EventDetailService(NpgsqlConnectionFactory connectionFactory)
    {
        _connectionFactory = connectionFactory;
    }

    public EventDetailResponse? Get(string timelineId, string eventId)
    {
        if (string.IsNullOrWhiteSpace(timelineId)) throw new ArgumentException("timelineId required", nameof(timelineId));
        if (string.IsNullOrWhiteSpace(eventId)) throw new ArgumentException("eventId required", nameof(eventId));

        using var connection = _connectionFactory.OpenConnection();

        var sources = LoadSources(connection, eventId);
        var evt = LoadEvent(connection, timelineId, eventId, sources);
        if (evt is null) return null;

        var ancestors = LoadAncestors(connection, timelineId, evt.ParentId);
        var childrenSummary = LoadChildrenSummary(connection, timelineId, eventId);

        return new EventDetailResponse
        {
            TimelineId = timelineId,
            Event = evt,
            Ancestors = ancestors,
            ChildrenSummary = childrenSummary,
        };
    }

    private static EventDetailEventDto? LoadEvent(
        NpgsqlConnection connection,
        string timelineId,
        string eventId,
        IReadOnlyList<EventDetailSourceDto> sources)
    {
        using var cmd = connection.CreateCommand();
        cmd.CommandText = @"
            SELECT id, parent_id, zoom_level, sequence, title, start_label, end_label,
                   start_ref, end_ref, start_sequence, end_sequence, summary, importance, canonical
            FROM timeline_events
            WHERE timeline_id = @timelineId AND id = @eventId
            LIMIT 1;";
        cmd.Parameters.AddWithValue("@timelineId", timelineId);
        cmd.Parameters.AddWithValue("@eventId", eventId);

        using var reader = cmd.ExecuteReader();
        if (!reader.Read()) return null;

        return new EventDetailEventDto
        {
            Id = reader.GetString(0),
            ParentId = reader.IsDBNull(1) ? null : reader.GetString(1),
            ZoomLevel = reader.GetInt32(2),
            Sequence = reader.GetInt32(3),
            Title = reader.GetString(4),
            StartLabel = reader.GetString(5),
            EndLabel = reader.GetString(6),
            StartRef = reader.GetString(7),
            EndRef = reader.GetString(8),
            StartSequence = reader.GetInt32(9),
            EndSequence = reader.GetInt32(10),
            Summary = reader.GetString(11),
            Importance = reader.GetInt32(12),
            Canonical = reader.GetBoolean(13),
            Sources = sources.Count > 0 ? sources : null,
            ScriptureRefs = null,
        };
    }

    private static List<EventDetailAncestorDto> LoadAncestors(
        NpgsqlConnection connection,
        string timelineId,
        string? parentId)
    {
        var ancestors = new List<EventDetailAncestorDto>();
        var currentId = parentId;
        for (int hops = 0; currentId is not null && hops < 16; hops++)
        {
            using var cmd = connection.CreateCommand();
            cmd.CommandText = @"
                SELECT id, parent_id, title, zoom_level
                FROM timeline_events
                WHERE timeline_id = @timelineId AND id = @id
                LIMIT 1;";
            cmd.Parameters.AddWithValue("@timelineId", timelineId);
            cmd.Parameters.AddWithValue("@id", currentId);
            using var reader = cmd.ExecuteReader();
            if (!reader.Read()) break;
            var id = reader.GetString(0);
            var nextParent = reader.IsDBNull(1) ? null : reader.GetString(1);
            var title = reader.GetString(2);
            var zoomLevel = reader.GetInt32(3);
            ancestors.Add(new EventDetailAncestorDto
            {
                Id = id,
                Title = title,
                ZoomLevel = zoomLevel,
            });
            currentId = nextParent;
        }
        ancestors.Reverse();
        return ancestors;
    }

    private static ChildrenSummaryDto LoadChildrenSummary(
        NpgsqlConnection connection,
        string timelineId,
        string eventId)
    {
        using var cmd = connection.CreateCommand();
        cmd.CommandText = @"
            SELECT zoom_level, COUNT(*)
            FROM timeline_events
            WHERE timeline_id = @timelineId AND parent_id = @parentId
            GROUP BY zoom_level
            ORDER BY zoom_level;";
        cmd.Parameters.AddWithValue("@timelineId", timelineId);
        cmd.Parameters.AddWithValue("@parentId", eventId);

        var byLevel = new Dictionary<string, int>();
        var total = 0;
        using var reader = cmd.ExecuteReader();
        while (reader.Read())
        {
            var level = reader.GetInt32(0);
            var count = reader.GetInt32(1);
            byLevel[level.ToString()] = count;
            total += count;
        }
        return new ChildrenSummaryDto
        {
            Total = total,
            ByZoomLevel = byLevel,
        };
    }

    private static List<EventDetailSourceDto> LoadSources(NpgsqlConnection connection, string eventId)
    {
        using var cmd = connection.CreateCommand();
        cmd.CommandText = @"
            SELECT source_ref, source_type
            FROM timeline_event_sources
            WHERE event_id = @eventId
            ORDER BY source_type, source_ref;";
        cmd.Parameters.AddWithValue("@eventId", eventId);

        var sources = new List<EventDetailSourceDto>();
        using var reader = cmd.ExecuteReader();
        while (reader.Read())
        {
            sources.Add(new EventDetailSourceDto
            {
                SourceRef = reader.GetString(0),
                SourceType = reader.GetString(1),
            });
        }
        return sources;
    }
}
