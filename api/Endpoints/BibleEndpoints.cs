using BibleTimeline.Api.Models;
using BibleTimeline.Api.Services;

namespace BibleTimeline.Api.Endpoints;

public static class BibleEndpoints
{
    public static IEndpointRouteBuilder MapBibleEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/bible").WithTags("Bible");

        group.MapGet("/versions", (BibleReadingService service) =>
        {
            var response = service.ListVersions();
            return Results.Ok(response);
        })
        .WithName("ListVersions")
        .Produces<VersionsListResponse>();

        group.MapGet("/verses",
            (string versions,
             int? fromSequence,
             int? toSequence,
             string? fromRef,
             string? toRef,
             string? manifestId,
             int? limit,
             BibleReadingService service) =>
        {
            var codes = (versions ?? string.Empty)
                .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
            if (codes.Length == 0 || codes.Length > 5)
            {
                return Results.BadRequest(new { error = "versions must contain 1..5 comma-separated codes" });
            }

            var hasRefs = fromRef is not null || toRef is not null;
            var hasSeqs = fromSequence.HasValue || toSequence.HasValue;
            if (hasRefs == hasSeqs)
            {
                return Results.BadRequest(new
                {
                    error = "Provide either fromRef+toRef OR fromSequence+toSequence"
                });
            }

            var response = service.GetRange(codes, fromSequence, toSequence, fromRef, toRef, manifestId, limit);
            return Results.Ok(response);
        })
        .WithName("GetVersesRange")
        .Produces<VersesRangeResponse>();

        return app;
    }
}
