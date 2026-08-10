using BibleTimeline.Api.Models;
using BibleTimeline.Api.Services;

namespace BibleTimeline.Api.Endpoints;

public static class StrongEndpoints
{
    public static IEndpointRouteBuilder MapStrongEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/strongs").WithTags("Strong");

        group.MapGet("/{strongNumber}", (string strongNumber, string? lang, StrongService service) =>
        {
            if (!StrongService.TryNormalizeDefinitionLanguage(lang, out var definitionLanguage))
            {
                return Results.BadRequest(new { error = "lang must be es or en" });
            }

            var response = service.Get(strongNumber, definitionLanguage);
            return response is null ? Results.NotFound() : Results.Ok(response);
        })
        .WithName("GetStrongEntry")
        .Produces<StrongEntryDto>()
        .Produces(StatusCodes.Status404NotFound);

        return app;
    }
}
