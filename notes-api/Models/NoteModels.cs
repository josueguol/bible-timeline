namespace BibleTimeline.NotesApi.Models;

public sealed class NoteCreateRequest
{
    public required string VerseRef { get; init; }
    public required string Content  { get; init; }
}

public sealed class NoteUpdateRequest
{
    public required string Content { get; init; }
}

public sealed class NoteDto
{
    public required Guid     Id        { get; init; }
    public required string   VerseRef  { get; init; }
    public required string   Content   { get; init; }
    public required DateTime CreatedAt { get; init; }
    public required DateTime UpdatedAt { get; init; }
    public int?              Sequence  { get; init; }
}

public sealed class NoteListResponse
{
    public required IReadOnlyList<NoteDto> Notes { get; init; }
}
