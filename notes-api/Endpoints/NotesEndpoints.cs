using System.Security.Claims;
using BibleTimeline.NotesApi.Models;
using BibleTimeline.NotesApi.Services;

namespace BibleTimeline.NotesApi.Endpoints;

public static class NotesEndpoints
{
    public static IEndpointRouteBuilder MapNotesEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app
            .MapGroup("/notes")
            .WithTags("Notes")
            .RequireAuthorization();

        group.MapGet("/",
            async (ClaimsPrincipal user, string? verse_ref, NotesService svc, CancellationToken ct) =>
            {
                if (!TryGetUserId(user, out var userId))
                    return Results.Unauthorized();

                if (string.IsNullOrWhiteSpace(verse_ref))
                    return Results.BadRequest(new { error = "verse_ref is required" });

                if (!NotesService.IsValidVerseRef(verse_ref))
                    return Results.BadRequest(new { error = "verse_ref format invalid (expected e.g. GEN.1.1)" });

                var result = await svc.GetForVerseAsync(userId, verse_ref, ct);
                return Results.Ok(result);
            })
            .WithName("GetNotesForVerse")
            .Produces<NoteListResponse>();

        group.MapGet("/all",
            async (ClaimsPrincipal user, NotesService svc, CancellationToken ct) =>
            {
                if (!TryGetUserId(user, out var userId))
                    return Results.Unauthorized();
                var result = await svc.GetAllWithSequenceAsync(userId, ct);
                return Results.Ok(result);
            })
            .WithName("GetAllNotes")
            .Produces<NoteListResponse>();

        group.MapPost("/",
            async (ClaimsPrincipal user, NoteCreateRequest req, NotesService svc, CancellationToken ct) =>
            {
                if (!TryGetUserId(user, out var userId))
                    return Results.Unauthorized();

                if (string.IsNullOrWhiteSpace(req.VerseRef) || string.IsNullOrWhiteSpace(req.Content))
                    return Results.BadRequest(new { error = "verseRef and content required" });

                if (!NotesService.IsValidVerseRef(req.VerseRef))
                    return Results.BadRequest(new { error = "verseRef format invalid (expected e.g. Génesis 1:1)" });

                if (req.Content.Length > 10_000)
                    return Results.BadRequest(new { error = "content exceeds 10,000 character limit" });

                var note = await svc.CreateAsync(userId, req.VerseRef, req.Content, ct);
                return note is null
                    ? Results.StatusCode(StatusCodes.Status500InternalServerError)
                    : Results.Created($"/notes/{note.Id}", note);
            })
            .WithName("CreateNote")
            .Produces<NoteDto>(StatusCodes.Status201Created);

        group.MapPut("/{id:guid}",
            async (Guid id, ClaimsPrincipal user, NoteUpdateRequest req, NotesService svc, CancellationToken ct) =>
            {
                if (!TryGetUserId(user, out var userId))
                    return Results.Unauthorized();

                if (string.IsNullOrWhiteSpace(req.Content))
                    return Results.BadRequest(new { error = "content required" });

                if (req.Content.Length > 10_000)
                    return Results.BadRequest(new { error = "content exceeds 10,000 character limit" });

                var note = await svc.UpdateAsync(userId, id, req.Content, ct);
                return note is null ? Results.NotFound() : Results.Ok(note);
            })
            .WithName("UpdateNote")
            .Produces<NoteDto>()
            .ProducesProblem(StatusCodes.Status404NotFound);

        group.MapDelete("/{id:guid}",
            async (Guid id, ClaimsPrincipal user, NotesService svc, CancellationToken ct) =>
            {
                if (!TryGetUserId(user, out var userId))
                    return Results.Unauthorized();

                var deleted = await svc.DeleteAsync(userId, id, ct);
                return deleted ? Results.NoContent() : Results.NotFound();
            })
            .WithName("DeleteNote")
            .Produces(StatusCodes.Status204NoContent)
            .ProducesProblem(StatusCodes.Status404NotFound);

        return app;
    }

    private static bool TryGetUserId(ClaimsPrincipal user, out Guid userId)
    {
        var sub = user.FindFirstValue("sub");
        return Guid.TryParse(sub, out userId);
    }
}
