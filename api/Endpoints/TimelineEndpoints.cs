using BibleTimeline.Api.Models;
using BibleTimeline.Api.Services;

namespace BibleTimeline.Api.Endpoints;

public static class TimelineEndpoints
{
    public static IEndpointRouteBuilder MapTimelineEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/timelines").WithTags("Timelines");

        group.MapGet("/{timelineId}/viewport",
            (string timelineId,
             double zoomFactor,
             int? focusSequence,
             string? focusRef,
             string? focusEventId,
             int? viewportEventBudget,
             bool? includeAncestors,
             TimelineViewportService service) =>
        {
            var request = new ViewportRequest
            {
                TimelineId = timelineId,
                ZoomFactor = zoomFactor,
                FocusSequence = focusSequence,
                FocusRef = focusRef,
                FocusEventId = focusEventId,
                ViewportEventBudget = viewportEventBudget,
                IncludeAncestors = includeAncestors,
            };
            if (request.ZoomFactor < 0 || request.ZoomFactor > 1)
            {
                return Results.BadRequest(new { error = "zoomFactor must be between 0 and 1" });
            }
            var response = service.Resolve(request);
            return Results.Ok(response);
        })
        .WithName("ResolveViewport")
        .Produces<ViewportResponse>();

        group.MapGet("/{timelineId}/events/{eventId}",
            (string timelineId, string eventId, EventDetailService service) =>
        {
            if (string.IsNullOrWhiteSpace(timelineId) || string.IsNullOrWhiteSpace(eventId))
            {
                return Results.BadRequest(new { error = "timelineId and eventId are required" });
            }
            var response = service.Get(timelineId, eventId);
            if (response is null)
            {
                return Results.NotFound(new { error = $"Event '{eventId}' not found in timeline '{timelineId}'" });
            }
            return Results.Ok(response);
        })
        .WithName("GetEventDetail")
        .Produces<EventDetailResponse>();

        return app;
    }
}
