using BibleTimeline.Api.Options;
using Microsoft.Extensions.Options;
using Npgsql;

namespace BibleTimeline.Api.Infrastructure;

/// <summary>
/// Opens PostgreSQL connections using the configured connection string.
/// </summary>
public class NpgsqlConnectionFactory
{
    private readonly string _connectionString;

    public NpgsqlConnectionFactory(IOptions<BibleTimelineOptions> options)
    {
        _connectionString = options.Value.ConnectionString;
    }

    public NpgsqlConnection OpenConnection()
    {
        var conn = new NpgsqlConnection(_connectionString);
        conn.Open();
        return conn;
    }
}
