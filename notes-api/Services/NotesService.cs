using System.Text.RegularExpressions;
using BibleTimeline.NotesApi.Infrastructure;
using BibleTimeline.NotesApi.Models;
using Npgsql;

namespace BibleTimeline.NotesApi.Services;

public sealed partial class NotesService(NpgsqlConnectionFactory factory)
{
    // Accepts display-format refs like "Génesis 1:1", "1 Corintios 13:4", "3 Juan 1:14"
    [GeneratedRegex(@"^[\p{L}\p{N}][^\t\n\r]{1,40} \d{1,3}:\d{1,3}$")]
    private static partial Regex VerseRefRegex();

    public static bool IsValidVerseRef(string verseRef)
        => VerseRefRegex().IsMatch(verseRef);

    public async Task<NoteListResponse> GetForVerseAsync(
        Guid userId, string verseRef, CancellationToken ct)
    {
        await using var conn = await factory.OpenConnectionAsync(ct);
        await using var cmd = new NpgsqlCommand("""
            SELECT id, verse_ref, content, created_at, updated_at
            FROM notes.user_notes
            WHERE user_id = @userId AND verse_ref = @verseRef
            ORDER BY created_at;
            """, conn);
        cmd.Parameters.AddWithValue("userId",   userId);
        cmd.Parameters.AddWithValue("verseRef", verseRef);

        var notes = new List<NoteDto>();
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
            notes.Add(MapRow(reader));

        return new NoteListResponse { Notes = notes };
    }

    public async Task<NoteDto?> CreateAsync(
        Guid userId, string verseRef, string content, CancellationToken ct)
    {
        await using var conn = await factory.OpenConnectionAsync(ct);
        await using var cmd = new NpgsqlCommand("""
            INSERT INTO notes.user_notes (user_id, verse_ref, content)
            VALUES (@userId, @verseRef, @content)
            RETURNING id, verse_ref, content, created_at, updated_at;
            """, conn);
        cmd.Parameters.AddWithValue("userId",   userId);
        cmd.Parameters.AddWithValue("verseRef", verseRef);
        cmd.Parameters.AddWithValue("content",  content);

        await using var reader = await cmd.ExecuteReaderAsync(ct);
        return await reader.ReadAsync(ct) ? MapRow(reader) : null;
    }

    public async Task<NoteDto?> UpdateAsync(
        Guid userId, Guid noteId, string content, CancellationToken ct)
    {
        await using var conn = await factory.OpenConnectionAsync(ct);
        await using var cmd = new NpgsqlCommand("""
            UPDATE notes.user_notes
            SET content = @content, updated_at = now()
            WHERE id = @id AND user_id = @userId
            RETURNING id, verse_ref, content, created_at, updated_at;
            """, conn);
        cmd.Parameters.AddWithValue("content", content);
        cmd.Parameters.AddWithValue("id",      noteId);
        cmd.Parameters.AddWithValue("userId",  userId);

        await using var reader = await cmd.ExecuteReaderAsync(ct);
        return await reader.ReadAsync(ct) ? MapRow(reader) : null;
    }

    public async Task<bool> DeleteAsync(Guid userId, Guid noteId, CancellationToken ct)
    {
        await using var conn = await factory.OpenConnectionAsync(ct);
        await using var cmd = new NpgsqlCommand("""
            DELETE FROM notes.user_notes WHERE id = @id AND user_id = @userId;
            """, conn);
        cmd.Parameters.AddWithValue("id",     noteId);
        cmd.Parameters.AddWithValue("userId", userId);
        var affected = await cmd.ExecuteNonQueryAsync(ct);
        return affected > 0;
    }

    public async Task<NoteListResponse> GetAllWithSequenceAsync(Guid userId, CancellationToken ct)
    {
        await using var conn = await factory.OpenConnectionAsync(ct);
        await using var cmd = new NpgsqlCommand("""
            SELECT n.id, n.verse_ref, n.content, n.created_at, n.updated_at,
                   v.sequence
            FROM notes.user_notes n
            LEFT JOIN public.timeline_verse_order v ON v.ref = n.verse_ref
            WHERE n.user_id = @userId
            ORDER BY n.created_at;
            """, conn);
        cmd.Parameters.AddWithValue("userId", userId);

        var notes = new List<NoteDto>();
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
            notes.Add(MapRowWithSeq(reader));

        return new NoteListResponse { Notes = notes };
    }

    private static NoteDto MapRow(NpgsqlDataReader r) => new()
    {
        Id        = r.GetGuid(0),
        VerseRef  = r.GetString(1),
        Content   = r.GetString(2),
        CreatedAt = r.GetDateTime(3),
        UpdatedAt = r.GetDateTime(4),
    };

    private static NoteDto MapRowWithSeq(NpgsqlDataReader r) => new()
    {
        Id        = r.GetGuid(0),
        VerseRef  = r.GetString(1),
        Content   = r.GetString(2),
        CreatedAt = r.GetDateTime(3),
        UpdatedAt = r.GetDateTime(4),
        Sequence  = r.IsDBNull(5) ? null : r.GetInt32(5),
    };
}
