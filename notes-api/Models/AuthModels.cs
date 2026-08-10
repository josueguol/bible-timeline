namespace BibleTimeline.NotesApi.Models;

public sealed class AuthRequest
{
    public required string Email    { get; init; }
    public required string Password { get; init; }
}

public sealed class RefreshRequest
{
    public required string RefreshToken { get; init; }
}

public sealed class LogoutRequest
{
    public required string RefreshToken { get; init; }
}

public sealed class GoogleAuthRequest
{
    public required string IdToken { get; init; }
}

public sealed class FacebookAuthRequest
{
    public required string AccessToken { get; init; }
}

public sealed class UserDto
{
    public required Guid   Id          { get; init; }
    public required string Email       { get; init; }
    public required string DisplayName { get; init; }
}

public sealed class AuthResponse
{
    public required string  AccessToken  { get; init; }
    public required string  RefreshToken { get; init; }
    public required UserDto User         { get; init; }
}

// Not exposed over wire — shared between services only
public sealed record OAuthUserInfo(
    string  Provider,
    string  ProviderId,
    string? Email,
    string? DisplayName = null);
