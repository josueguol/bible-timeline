using BibleTimeline.Api.Models;
using BibleTimeline.Api.Services;

namespace BibleTimeline.Api.Endpoints;

public static class SearchEndpoints
{
    public static IEndpointRouteBuilder MapSearchEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/search").WithTags("Search");

        group.MapGet("/",
            (string q,
             string? versionId,
             string? timelineId,
             string? categories,
             int? limit,
             SearchService service) =>
        {
            if (string.IsNullOrWhiteSpace(q) || q.Length > 256)
            {
                return Results.BadRequest(new { error = "q must be a non-empty string <= 256 chars" });
            }
            var categoryList = string.IsNullOrWhiteSpace(categories)
                ? null
                : categories
                    .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                    .ToArray();
            var response = service.Search(q, versionId, timelineId, categoryList, limit);
            return Results.Ok(response);
        })
        .WithName("Search")
        .Produces<SearchResponse>();

        return app;
    }
}
