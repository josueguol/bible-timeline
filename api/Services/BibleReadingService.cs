using BibleTimeline.Api.Infrastructure;
using BibleTimeline.Api.Models;
using BibleTimeline.Api.Options;
using Microsoft.Extensions.Options;
using Npgsql;

namespace BibleTimeline.Api.Services;

/// <summary>
/// Reads <c>bible_versions</c>, <c>bible_verses</c>, and <c>timeline_verse_order</c>.
/// </summary>
public sealed class BibleReadingService
{
    private readonly NpgsqlConnectionFactory _connectionFactory;
    private readonly BibleTimelineOptions _options;

    public BibleReadingService(
        NpgsqlConnectionFactory connectionFactory,
        IOptions<BibleTimelineOptions> options)
    {
        _connectionFactory = connectionFactory;
        _options = options.Value;
    }

    public VersionsListResponse ListVersions()
    {
        using var connection = _connectionFactory.OpenConnection();

        string? primaryVersionId = null;
        using (var primaryCmd = connection.CreateCommand())
        {
            primaryCmd.CommandText = @"
                SELECT source_version_id
                FROM timeline_manifests
                WHERE manifest_id = @manifestId
                LIMIT 1;";
            primaryCmd.Parameters.AddWithValue("@manifestId", _options.DefaultManifestId);
            var value = primaryCmd.ExecuteScalar();
            primaryVersionId = value as string;
        }

        var verseCountByVersion = new Dictionary<string, int>(StringComparer.Ordinal);
        using (var countCmd = connection.CreateCommand())
        {
            countCmd.CommandText = @"
                SELECT version_id, COUNT(*)
                FROM bible_verses
                GROUP BY version_id;";
            using var reader = countCmd.ExecuteReader();
            while (reader.Read())
            {
                verseCountByVersion[reader.GetString(0)] = reader.GetInt32(1);
            }
        }

        var versions = new List<BibleVersionDto>();
        using (var cmd = connection.CreateCommand())
        {
            cmd.CommandText = @"
                SELECT version_id, code, title, language, source_path
                FROM bible_versions
                ORDER BY code;";
            using var reader = cmd.ExecuteReader();
            while (reader.Read())
            {
                var versionId = reader.GetString(0);
                var code = reader.GetString(1);
                var title = reader.GetString(2);
                var language = reader.GetString(3);
                var sourcePath = reader.IsDBNull(4) ? null : reader.GetString(4);
                versions.Add(new BibleVersionDto
                {
                    VersionId = versionId,
                    Code = code,
                    Title = title,
                    Language = language,
                    LanguageFamily = InferLanguageFamily(code, language),
                    IsPrimary = versionId == primaryVersionId,
                    VerseCount = verseCountByVersion.TryGetValue(versionId, out var n) ? n : (int?)null,
                    SourcePath = sourcePath,
                });
            }
        }

        return new VersionsListResponse { Versions = versions };
    }

    public VersesRangeResponse GetRange(
        IReadOnlyList<string> versionCodes,
        int? fromSequence,
        int? toSequence,
        string? fromRef,
        string? toRef,
        string? manifestId,
        int? limit,
        bool includeStrong = false,
        string? strongLanguage = null)
    {
        if (versionCodes.Count is 0 or > 5)
        {
            throw new ArgumentException("versions must contain 1..5 entries", nameof(versionCodes));
        }
        manifestId ??= _options.DefaultManifestId;
        limit ??= 200;

        using var connection = _connectionFactory.OpenConnection();

        var codeToVersionId = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        using (var cmd = connection.CreateCommand())
        {
            cmd.CommandText = @"SELECT version_id, code FROM bible_versions;";
            using var reader = cmd.ExecuteReader();
            while (reader.Read())
            {
                codeToVersionId[reader.GetString(1)] = reader.GetString(0);
            }
        }
        var resolvedVersionIds = new List<string>();
        var resolvedCodes = new List<string>();
        foreach (var code in versionCodes)
        {
            if (!codeToVersionId.TryGetValue(code, out var id))
            {
                throw new ArgumentException($"Unknown version code: {code}", nameof(versionCodes));
            }
            resolvedVersionIds.Add(id);
            resolvedCodes.Add(code);
        }

        int fromSeq;
        int toSeq;
        string? resolvedFromRef = fromRef;
        string? resolvedToRef = toRef;

        if (fromSequence.HasValue && toSequence.HasValue)
        {
            fromSeq = fromSequence.Value;
            toSeq = toSequence.Value;
        }
        else if (!string.IsNullOrWhiteSpace(fromRef) && !string.IsNullOrWhiteSpace(toRef))
        {
            fromSeq = LookupSequenceByRef(connection, manifestId!, fromRef!);
            toSeq = LookupSequenceByRef(connection, manifestId!, toRef!);
        }
        else
        {
            throw new ArgumentException(
                "Provide either both fromSequence+toSequence or both fromRef+toRef");
        }

        if (fromSeq > toSeq)
        {
            throw new ArgumentException("fromSequence/fromRef must be <= toSequence/toRef");
        }

        if (toSeq - fromSeq + 1 > limit)
        {
            toSeq = fromSeq + limit.Value - 1;
        }

        var rows = new List<VerseRangeRowDto>();
        using (var cmd = connection.CreateCommand())
        {
            cmd.CommandText = @"
                SELECT sequence, ref, book, chapter, verse
                FROM timeline_verse_order
                WHERE manifest_id = @manifestId
                  AND sequence BETWEEN @from AND @to
                ORDER BY sequence;";
            cmd.Parameters.AddWithValue("@manifestId", manifestId!);
            cmd.Parameters.AddWithValue("@from", fromSeq);
            cmd.Parameters.AddWithValue("@to", toSeq);
            using var reader = cmd.ExecuteReader();
            while (reader.Read())
            {
                rows.Add(new VerseRangeRowDto
                {
                    Sequence = reader.GetInt32(0),
                    Ref = reader.GetString(1),
                    Book = reader.GetString(2),
                    Chapter = reader.GetInt32(3),
                    Verse = reader.GetInt32(4),
                });
            }
        }

        if (rows.Count == 0)
        {
            return new VersesRangeResponse
            {
                ManifestId = manifestId!,
                Versions = resolvedCodes,
                Range = new VerseRangeDto
                {
                    FromSequence = fromSeq,
                    ToSequence = toSeq,
                    FromRef = resolvedFromRef,
                    ToRef = resolvedToRef,
                },
                Rows = rows,
            };
        }

        var refs = rows.Select(r => r.Ref).Distinct().ToArray();
        using (var cmd = connection.CreateCommand())
        {
            var sb = new System.Text.StringBuilder();
            sb.Append("SELECT version_id, ref, text FROM bible_verses WHERE version_id IN (");
            for (int i = 0; i < resolvedVersionIds.Count; i++)
            {
                var name = $"@v{i}";
                if (i > 0) sb.Append(',');
                sb.Append(name);
                cmd.Parameters.AddWithValue(name, resolvedVersionIds[i]);
            }
            sb.Append(") AND ref IN (");
            for (int i = 0; i < refs.Length; i++)
            {
                var name = $"@r{i}";
                if (i > 0) sb.Append(',');
                sb.Append(name);
                cmd.Parameters.AddWithValue(name, refs[i]);
            }
            sb.Append(");");
            cmd.CommandText = sb.ToString();

            var versionIdToCode = new Dictionary<string, string>(StringComparer.Ordinal);
            for (int i = 0; i < resolvedVersionIds.Count; i++)
            {
                versionIdToCode[resolvedVersionIds[i]] = resolvedCodes[i];
            }
            var rowsByRef = rows.ToDictionary(r => r.Ref, r => r);

            foreach (var row in rows)
            {
                foreach (var code in resolvedCodes)
                {
                    row.Texts[code] = null;
                }
            }

            using var reader = cmd.ExecuteReader();
            while (reader.Read())
            {
                var versionId = reader.GetString(0);
                var refValue = reader.GetString(1);
                var text = reader.GetString(2);
                if (rowsByRef.TryGetValue(refValue, out var row)
                    && versionIdToCode.TryGetValue(versionId, out var code))
                {
                    row.Texts[code] = text;
                }
            }
        }

        Dictionary<string, StrongEntryDto>? lexicon = null;
        if (includeStrong && rows.Count > 0)
        {
            lexicon = LoadSegments(
                connection,
                rows,
                resolvedVersionIds,
                resolvedCodes,
                StrongService.NormalizeDefinitionLanguage(strongLanguage));
        }

        if (resolvedFromRef is null) resolvedFromRef = rows[0].Ref;
        if (resolvedToRef is null) resolvedToRef = rows[^1].Ref;

        return new VersesRangeResponse
        {
            ManifestId = manifestId!,
            Versions = resolvedCodes,
            Range = new VerseRangeDto
            {
                FromSequence = fromSeq,
                ToSequence = toSeq,
                FromRef = resolvedFromRef,
                ToRef = resolvedToRef,
            },
            Rows = rows,
            Lexicon = lexicon is { Count: > 0 } ? lexicon : null,
        };
    }

    private static Dictionary<string, StrongEntryDto> LoadSegments(
        NpgsqlConnection connection,
        IReadOnlyList<VerseRangeRowDto> rows,
        IReadOnlyList<string> versionIds,
        IReadOnlyList<string> versionCodes,
        string definitionLanguage)
    {
        var refs = rows.Select(r => r.Ref).Distinct().ToArray();
        var versionIdToCode = new Dictionary<string, string>(StringComparer.Ordinal);
        for (var index = 0; index < versionIds.Count; index++)
        {
            versionIdToCode[versionIds[index]] = versionCodes[index];
        }

        var rowsByRef = rows.ToDictionary(r => r.Ref, r => r, StringComparer.Ordinal);
        var strongNumbers = new SortedSet<string>(StringComparer.Ordinal);

        using (var cmd = connection.CreateCommand())
        {
            var sb = new System.Text.StringBuilder();
            sb.Append(@"
                SELECT s.version_id,
                       s.ref,
                       s.position,
                       s.text,
                       ss.strong_number,
                       ss.strong_raw
                FROM bible_verse_segments s
                LEFT JOIN bible_verse_segment_strongs ss
                  ON ss.version_id = s.version_id
                 AND ss.ref = s.ref
                 AND ss.position = s.position
                WHERE s.version_id IN (");
            for (var index = 0; index < versionIds.Count; index++)
            {
                var name = $"@v{index}";
                if (index > 0) sb.Append(',');
                sb.Append(name);
                cmd.Parameters.AddWithValue(name, versionIds[index]);
            }
            sb.Append(") AND s.ref IN (");
            for (var index = 0; index < refs.Length; index++)
            {
                var name = $"@r{index}";
                if (index > 0) sb.Append(',');
                sb.Append(name);
                cmd.Parameters.AddWithValue(name, refs[index]);
            }
            sb.Append(@")
                ORDER BY s.ref, s.version_id, s.position, ss.sequence;");
            cmd.CommandText = sb.ToString();

            var segmentsByKey = new Dictionary<(string Ref, string Code, int Position), SegmentBuilder>();
            using var reader = cmd.ExecuteReader();
            while (reader.Read())
            {
                var versionId = reader.GetString(0);
                var refValue = reader.GetString(1);
                var position = reader.GetInt32(2);
                var text = reader.GetString(3);
                if (!versionIdToCode.TryGetValue(versionId, out var code))
                {
                    continue;
                }
                if (!rowsByRef.TryGetValue(refValue, out var row))
                {
                    continue;
                }

                row.Segments ??= new Dictionary<string, IReadOnlyList<VerseSegmentDto>>(StringComparer.Ordinal);
                var key = (refValue, code, position);
                if (!segmentsByKey.TryGetValue(key, out var builder))
                {
                    builder = new SegmentBuilder(position, text);
                    segmentsByKey[key] = builder;
                }

                if (!reader.IsDBNull(4))
                {
                    var strongNumber = reader.GetString(4);
                    var strongRaw = reader.IsDBNull(5) ? strongNumber : reader.GetString(5);
                    builder.Strongs.Add(new VerseSegmentStrongDto
                    {
                        StrongNumber = strongNumber,
                        StrongRaw = strongRaw,
                    });
                    strongNumbers.Add(strongNumber);
                }
            }

            foreach (var group in segmentsByKey
                .GroupBy(item => (item.Key.Ref, item.Key.Code))
                .OrderBy(group => group.Key.Ref, StringComparer.Ordinal)
                .ThenBy(group => group.Key.Code, StringComparer.Ordinal))
            {
                if (!rowsByRef.TryGetValue(group.Key.Ref, out var row) || row.Segments is null)
                {
                    continue;
                }
                row.Segments[group.Key.Code] = group
                    .Select(item => item.Value)
                    .OrderBy(item => item.Position)
                    .Select(item => new VerseSegmentDto
                    {
                        Position = item.Position,
                        Text = item.Text,
                        Strongs = item.Strongs,
                    })
                    .ToList();
            }
        }

        return LoadLexicon(connection, strongNumbers, definitionLanguage);
    }

    private static Dictionary<string, StrongEntryDto> LoadLexicon(
        NpgsqlConnection connection,
        IReadOnlyCollection<string> strongNumbers,
        string definitionLanguage)
    {
        var lexicon = new Dictionary<string, StrongEntryDto>(StringComparer.Ordinal);
        if (strongNumbers.Count == 0)
        {
            return lexicon;
        }

        using var cmd = connection.CreateCommand();
        var sb = new System.Text.StringBuilder();
        if (definitionLanguage == "en")
        {
            sb.Append(@"
                SELECT strong_number,
                       language,
                       lemma,
                       transliteration,
                       pronunciation,
                       definition,
                       derivation,
                       kjv_definition,
                       source,
                       'en' AS definition_language,
                       'source' AS translation_status
                FROM strong_entries
                WHERE strong_number IN (");
        }
        else
        {
            sb.Append(@"
                SELECT e.strong_number,
                       e.language,
                       e.lemma,
                       e.transliteration,
                       e.pronunciation,
                       COALESCE(NULLIF(t.definition, ''), e.definition) AS definition,
                       COALESCE(NULLIF(t.derivation, ''), e.derivation) AS derivation,
                       COALESCE(NULLIF(t.kjv_definition, ''), e.kjv_definition) AS kjv_definition,
                       e.source,
                       CASE WHEN NULLIF(t.definition, '') IS NULL THEN 'en' ELSE t.language_code END AS definition_language,
                       CASE WHEN NULLIF(t.definition, '') IS NULL THEN 'fallback' ELSE t.translation_status END AS translation_status
                FROM strong_entries e
                LEFT JOIN strong_entry_translations t
                  ON t.strong_number = e.strong_number
                 AND t.language_code = @definitionLanguage
                WHERE e.strong_number IN (");
            cmd.Parameters.AddWithValue("@definitionLanguage", definitionLanguage);
        }
        var index = 0;
        foreach (var strongNumber in strongNumbers)
        {
            var name = $"@s{index}";
            if (index > 0) sb.Append(',');
            sb.Append(name);
            cmd.Parameters.AddWithValue(name, strongNumber);
            index++;
        }
        sb.Append(");");
        cmd.CommandText = sb.ToString();

        using var reader = cmd.ExecuteReader();
        while (reader.Read())
        {
            var strongNumber = reader.GetString(0);
            lexicon[strongNumber] = new StrongEntryDto
            {
                StrongNumber = strongNumber,
                Language = reader.GetString(1),
                Lemma = reader.GetString(2),
                Transliteration = reader.IsDBNull(3) ? null : reader.GetString(3),
                Pronunciation = reader.IsDBNull(4) ? null : reader.GetString(4),
                Definition = reader.GetString(5),
                Derivation = reader.IsDBNull(6) ? null : reader.GetString(6),
                KjvDefinition = reader.IsDBNull(7) ? null : reader.GetString(7),
                Source = reader.GetString(8),
                DefinitionLanguage = reader.GetString(9),
                TranslationStatus = reader.GetString(10),
            };
        }

        return lexicon;
    }

    private sealed class SegmentBuilder
    {
        public SegmentBuilder(int position, string text)
        {
            Position = position;
            Text = text;
        }

        public int Position { get; }
        public string Text { get; }
        public List<VerseSegmentStrongDto> Strongs { get; } = new();
    }

    public int? LookupSequenceByRefOrNull(NpgsqlConnection connection, string manifestId, string refValue)
    {
        using var cmd = connection.CreateCommand();
        cmd.CommandText = @"
            SELECT sequence
            FROM timeline_verse_order
            WHERE manifest_id = @manifestId AND ref = @ref
            LIMIT 1;";
        cmd.Parameters.AddWithValue("@manifestId", manifestId);
        cmd.Parameters.AddWithValue("@ref", refValue);
        var value = cmd.ExecuteScalar();
        if (value is null || value == DBNull.Value) return null;
        return Convert.ToInt32(value);
    }

    private int LookupSequenceByRef(NpgsqlConnection connection, string manifestId, string refValue)
    {
        var seq = LookupSequenceByRefOrNull(connection, manifestId, refValue);
        if (seq is null)
        {
            throw new ArgumentException($"ref not found in manifest {manifestId}: {refValue}");
        }
        return seq.Value;
    }

    private static string InferLanguageFamily(string code, string language)
    {
        var upperCode = code.ToUpperInvariant();
        if (upperCode.StartsWith("HEB") || upperCode.Contains("OSHB") || upperCode == "BHS")
        {
            return "original-hebrew";
        }
        if (upperCode.StartsWith("GRC") || upperCode == "LXX")
        {
            return "original-greek";
        }
        if (string.Equals(language, "es", StringComparison.OrdinalIgnoreCase))
        {
            return "es";
        }
        return "other";
    }
}
