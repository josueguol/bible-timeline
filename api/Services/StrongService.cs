using System.Text.RegularExpressions;
using BibleTimeline.Api.Infrastructure;
using BibleTimeline.Api.Models;
using Npgsql;

namespace BibleTimeline.Api.Services;

public sealed partial class StrongService
{
    private readonly NpgsqlConnectionFactory _connectionFactory;

    public StrongService(NpgsqlConnectionFactory connectionFactory)
    {
        _connectionFactory = connectionFactory;
    }

    public StrongEntryDto? Get(string strongNumber, string? definitionLanguage = null)
    {
        var normalized = NormalizeStrong(strongNumber);
        if (normalized is null)
        {
            return null;
        }

        using var connection = _connectionFactory.OpenConnection();
        return Get(connection, normalized, NormalizeDefinitionLanguage(definitionLanguage));
    }

    public static string? NormalizeStrong(string value)
    {
        var match = StrongRegex().Match(value.Trim());
        if (!match.Success)
        {
            return null;
        }

        var prefix = match.Groups["prefix"].Value.ToUpperInvariant();
        var number = int.Parse(match.Groups["number"].Value);
        return $"{prefix}{number}";
    }

    public static string NormalizeDefinitionLanguage(string? value)
    {
        return TryNormalizeDefinitionLanguage(value, out var language) ? language : "es";
    }

    public static bool TryNormalizeDefinitionLanguage(string? value, out string language)
    {
        var normalized = (value ?? "es").Trim().ToLowerInvariant();
        if (normalized is "es" or "en")
        {
            language = normalized;
            return true;
        }

        language = "es";
        return false;
    }

    private static StrongEntryDto? Get(
        NpgsqlConnection connection,
        string strongNumber,
        string definitionLanguage)
    {
        using var cmd = connection.CreateCommand();
        if (definitionLanguage == "en")
        {
            cmd.CommandText = @"
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
                WHERE strong_number = @strongNumber
                LIMIT 1;";
        }
        else
        {
            cmd.CommandText = @"
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
                WHERE e.strong_number = @strongNumber
                LIMIT 1;";
            cmd.Parameters.AddWithValue("@definitionLanguage", definitionLanguage);
        }
        cmd.Parameters.AddWithValue("@strongNumber", strongNumber);

        using var reader = cmd.ExecuteReader();
        if (!reader.Read())
        {
            return null;
        }

        return new StrongEntryDto
        {
            StrongNumber = reader.GetString(0),
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

    [GeneratedRegex(@"^(?<prefix>[GH])0*(?<number>\d+)$", RegexOptions.IgnoreCase)]
    private static partial Regex StrongRegex();
}
