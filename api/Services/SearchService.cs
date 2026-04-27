using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using BibleTimeline.Api.Infrastructure;
using BibleTimeline.Api.Models;
using BibleTimeline.Api.Options;
using Microsoft.Extensions.Options;
using Npgsql;

namespace BibleTimeline.Api.Services;

/// <summary>
/// Categorized search over references, events, and verse text. Mirrors the three
/// "slots" in <c>docs/contracts/search-response.schema.json</c>: reference / event / text.
/// </summary>
public sealed class SearchService
{
    private readonly NpgsqlConnectionFactory _connectionFactory;
    private readonly BibleTimelineOptions _options;

    private static readonly Regex ReferenceRegex = new(
        @"^\s*(?<book>(?:[1-3]\s+)?[\p{L}]+(?:\s+[\p{L}]+)*?)\s+(?<chapter>\d+)(?:\s*[:.]\s*(?<verse>\d+)(?:\s*[-–]\s*(?<end>\d+))?)?\s*$",
        RegexOptions.Compiled | RegexOptions.IgnoreCase);

    public SearchService(
        NpgsqlConnectionFactory connectionFactory,
        IOptions<BibleTimelineOptions> options)
    {
        _connectionFactory = connectionFactory;
        _options = options.Value;
    }

    public SearchResponse Search(
        string query,
        string? versionCode,
        string? timelineId,
        IReadOnlyList<string>? categories,
        int? limit)
    {
        if (string.IsNullOrWhiteSpace(query))
        {
            throw new ArgumentException("q must be non-empty", nameof(query));
        }
        var trimmed = query.Trim();
        var effectiveTimelineId = string.IsNullOrWhiteSpace(timelineId) ? _options.DefaultTimelineId : timelineId!;
        var effectiveCategories = NormalizeCategories(categories);
        var perCategoryLimit = Math.Max(1, Math.Min(limit ?? 10, 50));

        using var connection = _connectionFactory.OpenConnection();

        var resolvedVersionId = ResolveVersionId(connection, versionCode);
        var manifestId = _options.DefaultManifestId;

        var results = new List<SearchResultDto>();

        if (effectiveCategories.Contains("reference"))
        {
            results.AddRange(SearchReferences(connection, manifestId, trimmed, perCategoryLimit));
        }

        if (effectiveCategories.Contains("event"))
        {
            results.AddRange(SearchEvents(connection, effectiveTimelineId, trimmed, perCategoryLimit));
        }

        if (effectiveCategories.Contains("text"))
        {
            results.AddRange(SearchVerseText(connection, manifestId, resolvedVersionId, trimmed, perCategoryLimit));
        }

        var grouped = results
            .GroupBy(r => r.Category)
            .OrderBy(g => CategoryOrdinal(g.Key))
            .SelectMany(g => g.OrderByDescending(r => r.Score ?? 0));

        return new SearchResponse
        {
            Query = trimmed,
            Results = grouped.Take(perCategoryLimit * effectiveCategories.Count).ToList(),
        };
    }

    private static HashSet<string> NormalizeCategories(IReadOnlyList<string>? categories)
    {
        var all = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "reference", "event", "text" };
        if (categories is null || categories.Count == 0) return all;
        var filtered = categories
            .Where(c => all.Contains(c))
            .Select(c => c.ToLowerInvariant())
            .ToHashSet(StringComparer.Ordinal);
        return filtered.Count == 0 ? all : filtered;
    }

    private static int CategoryOrdinal(string category) => category switch
    {
        "reference" => 0,
        "event" => 1,
        "text" => 2,
        _ => 3,
    };

    private static string? ResolveVersionId(NpgsqlConnection connection, string? versionIdentifier)
    {
        if (string.IsNullOrWhiteSpace(versionIdentifier)) return null;
        using var cmd = connection.CreateCommand();
        cmd.CommandText = @"
            SELECT version_id
            FROM bible_versions
            WHERE code = @value OR version_id = @value
            LIMIT 1;";
        cmd.Parameters.AddWithValue("@value", versionIdentifier);
        var value = cmd.ExecuteScalar();
        return value as string;
    }

    private static IEnumerable<SearchResultDto> SearchReferences(
        NpgsqlConnection connection,
        string manifestId,
        string query,
        int limit)
    {
        var match = ReferenceRegex.Match(query);
        if (!match.Success) yield break;

        var bookInput = NormalizeWhitespace(match.Groups["book"].Value);
        var chapter = int.Parse(match.Groups["chapter"].Value, CultureInfo.InvariantCulture);
        int? verse = match.Groups["verse"].Success
            ? int.Parse(match.Groups["verse"].Value, CultureInfo.InvariantCulture)
            : null;

        var books = LoadBooks(connection, manifestId);
        var candidates = books
            .Where(b => MatchesBook(b, bookInput))
            .Take(5)
            .ToList();
        if (candidates.Count == 0) yield break;

        foreach (var book in candidates)
        {
            using var cmd = connection.CreateCommand();
            if (verse.HasValue)
            {
                cmd.CommandText = @"
                    SELECT sequence, ref
                    FROM timeline_verse_order
                    WHERE manifest_id = @manifestId AND book = @book AND chapter = @chapter AND verse = @verse
                    LIMIT 1;";
                cmd.Parameters.AddWithValue("@verse", verse.Value);
            }
            else
            {
                cmd.CommandText = @"
                    SELECT sequence, ref
                    FROM timeline_verse_order
                    WHERE manifest_id = @manifestId AND book = @book AND chapter = @chapter
                    ORDER BY sequence
                    LIMIT 1;";
            }
            cmd.Parameters.AddWithValue("@manifestId", manifestId);
            cmd.Parameters.AddWithValue("@book", book);
            cmd.Parameters.AddWithValue("@chapter", chapter);

            using var reader = cmd.ExecuteReader();
            if (reader.Read())
            {
                var sequence = reader.GetInt32(0);
                var refValue = reader.GetString(1);
                yield return new SearchResultDto
                {
                    Category = "reference",
                    Label = refValue,
                    Description = $"Cita bíblica en {book}",
                    Focus = new SearchFocusDto
                    {
                        FocusRef = refValue,
                        FocusSequence = sequence,
                    },
                    Score = ReferenceScore(book, bookInput, verse.HasValue),
                };
            }
        }
    }

    private static List<string> LoadBooks(NpgsqlConnection connection, string manifestId)
    {
        using var cmd = connection.CreateCommand();
        cmd.CommandText = @"
            SELECT book
            FROM timeline_verse_order
            WHERE manifest_id = @manifestId
            GROUP BY book
            ORDER BY MIN(sequence);";
        cmd.Parameters.AddWithValue("@manifestId", manifestId);
        var books = new List<string>();
        using var reader = cmd.ExecuteReader();
        while (reader.Read())
        {
            books.Add(reader.GetString(0));
        }
        return books;
    }

    private static bool MatchesBook(string book, string input)
    {
        var normalizedBook = StripDiacritics(book).ToLowerInvariant();
        var normalizedInput = StripDiacritics(input).ToLowerInvariant();
        if (string.IsNullOrEmpty(normalizedInput)) return false;
        return normalizedBook == normalizedInput
            || normalizedBook.StartsWith(normalizedInput, StringComparison.Ordinal)
            || normalizedBook.Contains(normalizedInput, StringComparison.Ordinal);
    }

    private static double ReferenceScore(string book, string input, bool hasVerse)
    {
        var normalizedBook = StripDiacritics(book).ToLowerInvariant();
        var normalizedInput = StripDiacritics(input).ToLowerInvariant();
        double bookScore;
        if (normalizedBook == normalizedInput) bookScore = 1.0;
        else if (normalizedBook.StartsWith(normalizedInput, StringComparison.Ordinal)) bookScore = 0.85;
        else bookScore = 0.7;
        return Math.Round(hasVerse ? Math.Min(1.0, bookScore + 0.05) : bookScore, 3);
    }

    private static IEnumerable<SearchResultDto> SearchEvents(
        NpgsqlConnection connection,
        string timelineId,
        string query,
        int limit)
    {
        using var cmd = connection.CreateCommand();
        cmd.CommandText = @"
            SELECT id, title, summary, zoom_level, start_ref, start_sequence
            FROM timeline_events
            WHERE timeline_id = @timelineId
              AND (LOWER(title) LIKE @needle OR LOWER(summary) LIKE @needle)
            ORDER BY
              CASE
                WHEN LOWER(title) LIKE @prefix THEN 0
                WHEN LOWER(title) LIKE @needle THEN 1
                ELSE 2
              END,
              zoom_level ASC,
              importance DESC,
              sequence ASC
            LIMIT @limit;";
        var needle = "%" + query.ToLowerInvariant() + "%";
        var prefix = query.ToLowerInvariant() + "%";
        cmd.Parameters.AddWithValue("@timelineId", timelineId);
        cmd.Parameters.AddWithValue("@needle", needle);
        cmd.Parameters.AddWithValue("@prefix", prefix);
        cmd.Parameters.AddWithValue("@limit", limit);

        using var reader = cmd.ExecuteReader();
        while (reader.Read())
        {
            var id = reader.GetString(0);
            var title = reader.GetString(1);
            var summary = reader.GetString(2);
            var zoomLevel = reader.GetInt32(3);
            var startRef = reader.GetString(4);
            var startSequence = reader.GetInt32(5);

            yield return new SearchResultDto
            {
                Category = "event",
                Label = title,
                Description = TrimPreview(summary, 160),
                Focus = new SearchFocusDto
                {
                    FocusEventId = id,
                    FocusRef = string.IsNullOrWhiteSpace(startRef) ? null : startRef,
                    FocusSequence = startSequence > 0 ? startSequence : null,
                },
                Score = EventScore(title, query, zoomLevel),
            };
        }
    }

    private static double EventScore(string title, string query, int zoomLevel)
    {
        var t = StripDiacritics(title).ToLowerInvariant();
        var q = StripDiacritics(query).ToLowerInvariant();
        double baseScore;
        if (t == q) baseScore = 1.0;
        else if (t.StartsWith(q, StringComparison.Ordinal)) baseScore = 0.85;
        else if (t.Contains(q, StringComparison.Ordinal)) baseScore = 0.7;
        else baseScore = 0.55;
        var zoomPenalty = Math.Min(zoomLevel, 5) * 0.02;
        return Math.Round(Math.Max(0, baseScore - zoomPenalty), 3);
    }

    private static IEnumerable<SearchResultDto> SearchVerseText(
        NpgsqlConnection connection,
        string manifestId,
        string? versionId,
        string query,
        int limit)
    {
        var resolvedVersionId = versionId ?? ResolveManifestVersionId(connection, manifestId);
        if (resolvedVersionId is null) yield break;

        using var cmd = connection.CreateCommand();
        cmd.CommandText = @"
            SELECT bv.ref, bv.text, vo.sequence
            FROM bible_verses bv
            JOIN timeline_verse_order vo
              ON vo.manifest_id = @manifestId AND vo.ref = bv.ref
            WHERE bv.version_id = @versionId
              AND LOWER(bv.text) LIKE @needle
            ORDER BY vo.sequence
            LIMIT @limit;";
        var needle = "%" + query.ToLowerInvariant() + "%";
        cmd.Parameters.AddWithValue("@manifestId", manifestId);
        cmd.Parameters.AddWithValue("@versionId", resolvedVersionId);
        cmd.Parameters.AddWithValue("@needle", needle);
        cmd.Parameters.AddWithValue("@limit", limit);

        using var reader = cmd.ExecuteReader();
        while (reader.Read())
        {
            var refValue = reader.GetString(0);
            var text = reader.GetString(1);
            var sequence = reader.GetInt32(2);

            yield return new SearchResultDto
            {
                Category = "text",
                Label = refValue,
                Description = null,
                Focus = new SearchFocusDto
                {
                    FocusRef = refValue,
                    FocusSequence = sequence,
                },
                Score = 0.6,
                Preview = TrimPreview(HighlightPreview(text, query), 200),
            };
        }
    }

    private static string? ResolveManifestVersionId(NpgsqlConnection connection, string manifestId)
    {
        using var cmd = connection.CreateCommand();
        cmd.CommandText = "SELECT source_version_id FROM timeline_manifests WHERE manifest_id = @manifestId LIMIT 1;";
        cmd.Parameters.AddWithValue("@manifestId", manifestId);
        return cmd.ExecuteScalar() as string;
    }

    private static string HighlightPreview(string text, string query)
    {
        var idx = text.IndexOf(query, StringComparison.OrdinalIgnoreCase);
        if (idx <= 0) return text;
        var start = Math.Max(0, idx - 40);
        var snippet = text[start..];
        return start > 0 ? "…" + snippet : snippet;
    }

    private static string TrimPreview(string text, int max)
    {
        if (text.Length <= max) return text;
        return text[..max].TrimEnd() + "…";
    }

    private static string NormalizeWhitespace(string value)
        => Regex.Replace(value, @"\s+", " ").Trim();

    private static string StripDiacritics(string value)
    {
        var normalized = value.Normalize(NormalizationForm.FormD);
        var sb = new StringBuilder(normalized.Length);
        foreach (var ch in normalized)
        {
            if (CharUnicodeInfo.GetUnicodeCategory(ch) != UnicodeCategory.NonSpacingMark)
            {
                sb.Append(ch);
            }
        }
        return sb.ToString().Normalize(NormalizationForm.FormC);
    }
}
