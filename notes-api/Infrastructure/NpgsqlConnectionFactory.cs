using BibleTimeline.NotesApi.Options;
using Microsoft.Extensions.Options;
using Npgsql;

namespace BibleTimeline.NotesApi.Infrastructure;

public sealed class NpgsqlConnectionFactory(IOptions<NotesApiOptions> options)
{
    private readonly string _connectionString = options.Value.ConnectionString;

    public async Task<NpgsqlConnection> OpenConnectionAsync(CancellationToken ct = default)
    {
        var conn = new NpgsqlConnection(_connectionString);
        await conn.OpenAsync(ct);
        return conn;
    }
}
