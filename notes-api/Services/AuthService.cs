using BibleTimeline.NotesApi.Infrastructure;
using BibleTimeline.NotesApi.Models;
using BibleTimeline.NotesApi.Options;
using Microsoft.Extensions.Options;
using Npgsql;

namespace BibleTimeline.NotesApi.Services;

public sealed class AuthService(
    NpgsqlConnectionFactory factory,
    TokenService tokenService,
    IOptions<NotesApiOptions> options)
{
    private readonly NotesApiOptions _opts = options.Value;

    public async Task<(AuthResponse? Response, string? Error)> RegisterAsync(
        string email, string password, CancellationToken ct)
    {
        var normalEmail = email.Trim().ToLowerInvariant();
        if (!IsValidEmail(normalEmail))
            return (null, "email_invalid");
        if (password.Length < 8)
            return (null, "password_too_short");

        var hash = BCrypt.Net.BCrypt.HashPassword(password, workFactor: 12);

        await using var conn = await factory.OpenConnectionAsync(ct);
        await using var cmd = new NpgsqlCommand("""
            INSERT INTO notes.users (email, pwd_hash)
            VALUES (@email, @hash)
            ON CONFLICT (email) DO NOTHING
            RETURNING id;
            """, conn);
        cmd.Parameters.AddWithValue("email", normalEmail);
        cmd.Parameters.AddWithValue("hash",  hash);

        var result = await cmd.ExecuteScalarAsync(ct);
        if (result is null or DBNull)
            return (null, "email_taken");

        var userId = (Guid)result;
        var response = await IssueTokensAsync(conn, userId, normalEmail, normalEmail, ct);
        return (response, null);
    }

    public async Task<AuthResponse?> LoginAsync(string email, string password, CancellationToken ct)
    {
        var normalEmail = email.Trim().ToLowerInvariant();

        await using var conn = await factory.OpenConnectionAsync(ct);
        await using var cmd = new NpgsqlCommand("""
            SELECT id, pwd_hash, COALESCE(display_name, email)
            FROM notes.users
            WHERE email = @email;
            """, conn);
        cmd.Parameters.AddWithValue("email", normalEmail);

        await using var reader = await cmd.ExecuteReaderAsync(ct);
        if (!await reader.ReadAsync(ct)) return null;

        var userId     = reader.GetGuid(0);
        var storedHash = reader.IsDBNull(1) ? null : reader.GetString(1);
        var displayName = reader.GetString(2);
        await reader.CloseAsync();

        if (storedHash is null || !BCrypt.Net.BCrypt.Verify(password, storedHash))
            return null;

        return await IssueTokensAsync(conn, userId, normalEmail, displayName, ct);
    }

    public async Task<AuthResponse?> LoginWithOAuthAsync(OAuthUserInfo info, CancellationToken ct)
    {
        await using var conn = await factory.OpenConnectionAsync(ct);

        // Find existing OAuth link
        await using var findCmd = new NpgsqlCommand("""
            SELECT u.id, u.email, COALESCE(u.display_name, u.email)
            FROM notes.oauth_accounts oa
            JOIN notes.users u ON u.id = oa.user_id
            WHERE oa.provider = @provider AND oa.provider_id = @pid;
            """, conn);
        findCmd.Parameters.AddWithValue("provider", info.Provider);
        findCmd.Parameters.AddWithValue("pid",      info.ProviderId);

        await using var reader = await findCmd.ExecuteReaderAsync(ct);
        if (await reader.ReadAsync(ct))
        {
            var uid  = reader.GetGuid(0);
            var mail = reader.GetString(1);
            var disp = reader.GetString(2);
            await reader.CloseAsync();
            return await IssueTokensAsync(conn, uid, mail, disp, ct);
        }
        await reader.CloseAsync();

        // No link found — upsert user by email, then link OAuth account
        var email       = info.Email ?? $"{info.Provider}.{info.ProviderId}@oauth.internal";
        var displayName = info.DisplayName ?? email;

        await using var upsertCmd = new NpgsqlCommand("""
            INSERT INTO notes.users (email, pwd_hash, display_name)
            VALUES (@email, NULL, @dn)
            ON CONFLICT (email) DO UPDATE
              SET display_name = COALESCE(notes.users.display_name, EXCLUDED.display_name)
            RETURNING id, COALESCE(display_name, email);
            """, conn);
        upsertCmd.Parameters.AddWithValue("email", email);
        upsertCmd.Parameters.AddWithValue("dn",    displayName);

        await using var upsertReader = await upsertCmd.ExecuteReaderAsync(ct);
        await upsertReader.ReadAsync(ct);
        var userId      = upsertReader.GetGuid(0);
        var resolvedDn  = upsertReader.GetString(1);
        await upsertReader.CloseAsync();

        await using var linkCmd = new NpgsqlCommand("""
            INSERT INTO notes.oauth_accounts (user_id, provider, provider_id, email)
            VALUES (@uid, @provider, @pid, @email)
            ON CONFLICT (provider, provider_id) DO NOTHING;
            """, conn);
        linkCmd.Parameters.AddWithValue("uid",      userId);
        linkCmd.Parameters.AddWithValue("provider", info.Provider);
        linkCmd.Parameters.AddWithValue("pid",      info.ProviderId);
        linkCmd.Parameters.AddWithValue("email",    (object?)info.Email ?? DBNull.Value);
        await linkCmd.ExecuteNonQueryAsync(ct);

        return await IssueTokensAsync(conn, userId, email, resolvedDn, ct);
    }

    public async Task<AuthResponse?> RefreshAsync(string rawToken, CancellationToken ct)
    {
        var hash = TokenService.HashRaw(rawToken);

        await using var conn = await factory.OpenConnectionAsync(ct);
        await using var cmd = new NpgsqlCommand("""
            SELECT rt.id, rt.user_id, u.email, COALESCE(u.display_name, u.email)
            FROM notes.refresh_tokens rt
            JOIN notes.users u ON u.id = rt.user_id
            WHERE rt.token_hash = @hash
              AND rt.revoked_at IS NULL
              AND rt.expires_at > now();
            """, conn);
        cmd.Parameters.AddWithValue("hash", hash);

        await using var reader = await cmd.ExecuteReaderAsync(ct);
        if (!await reader.ReadAsync(ct)) return null;

        var tokenId     = reader.GetGuid(0);
        var userId      = reader.GetGuid(1);
        var email       = reader.GetString(2);
        var displayName = reader.GetString(3);
        await reader.CloseAsync();

        await using var revokeCmd = new NpgsqlCommand("""
            UPDATE notes.refresh_tokens SET revoked_at = now() WHERE id = @id;
            """, conn);
        revokeCmd.Parameters.AddWithValue("id", tokenId);
        await revokeCmd.ExecuteNonQueryAsync(ct);

        return await IssueTokensAsync(conn, userId, email, displayName, ct);
    }

    public async Task LogoutAsync(string rawToken, CancellationToken ct)
    {
        var hash = TokenService.HashRaw(rawToken);
        await using var conn = await factory.OpenConnectionAsync(ct);
        await using var cmd = new NpgsqlCommand("""
            UPDATE notes.refresh_tokens
            SET revoked_at = now()
            WHERE token_hash = @hash AND revoked_at IS NULL;
            """, conn);
        cmd.Parameters.AddWithValue("hash", hash);
        await cmd.ExecuteNonQueryAsync(ct);
    }

    private async Task<AuthResponse> IssueTokensAsync(
        NpgsqlConnection conn, Guid userId, string email, string displayName, CancellationToken ct)
    {
        var accessToken               = tokenService.GenerateAccessToken(userId, email, displayName);
        var (rawRefresh, hashRefresh) = tokenService.GenerateRefreshToken();
        var expiresAt                 = DateTime.UtcNow.AddDays(_opts.RefreshTokenExpiryDays);

        await using var cmd = new NpgsqlCommand("""
            INSERT INTO notes.refresh_tokens (user_id, token_hash, expires_at)
            VALUES (@userId, @hash, @expiresAt);
            """, conn);
        cmd.Parameters.AddWithValue("userId",    userId);
        cmd.Parameters.AddWithValue("hash",      hashRefresh);
        cmd.Parameters.AddWithValue("expiresAt", expiresAt);
        await cmd.ExecuteNonQueryAsync(ct);

        return new AuthResponse
        {
            AccessToken  = accessToken,
            RefreshToken = rawRefresh,
            User         = new UserDto { Id = userId, Email = email, DisplayName = displayName },
        };
    }

    private static bool IsValidEmail(string email)
    {
        try
        {
            var addr = new System.Net.Mail.MailAddress(email);
            return addr.Address == email && email.Length <= 254;
        }
        catch { return false; }
    }
}
