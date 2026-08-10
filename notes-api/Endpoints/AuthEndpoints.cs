using BibleTimeline.NotesApi.Models;
using BibleTimeline.NotesApi.Options;
using BibleTimeline.NotesApi.Services;
using Microsoft.Extensions.Options;

namespace BibleTimeline.NotesApi.Endpoints;

public static class AuthEndpoints
{
    public static IEndpointRouteBuilder MapAuthEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/auth").WithTags("Auth");

        // ── Password auth ─────────────────────────────────────────────────────

        group.MapPost("/register",
            async (AuthRequest req, AuthService svc, CancellationToken ct) =>
            {
                if (string.IsNullOrWhiteSpace(req.Email) || string.IsNullOrWhiteSpace(req.Password))
                    return Results.BadRequest(new { error = "email and password required" });

                var (response, error) = await svc.RegisterAsync(req.Email, req.Password, ct);
                return error switch
                {
                    "email_invalid"      => Results.BadRequest(new { error = "invalid email format" }),
                    "password_too_short" => Results.BadRequest(new { error = "password must be at least 8 characters" }),
                    "email_taken"        => Results.Conflict(new { error = "email already registered" }),
                    null                 => Results.Created("/auth/register", response),
                    _                   => Results.BadRequest(new { error }),
                };
            })
            .WithName("Register")
            .RequireRateLimiting("register")
            .Produces<AuthResponse>(StatusCodes.Status201Created);

        group.MapPost("/login",
            async (AuthRequest req, AuthService svc, CancellationToken ct) =>
            {
                if (string.IsNullOrWhiteSpace(req.Email) || string.IsNullOrWhiteSpace(req.Password))
                    return Results.BadRequest(new { error = "email and password required" });

                var response = await svc.LoginAsync(req.Email, req.Password, ct);
                return response is null ? Results.Unauthorized() : Results.Ok(response);
            })
            .WithName("Login")
            .RequireRateLimiting("login")
            .Produces<AuthResponse>();

        group.MapPost("/refresh",
            async (RefreshRequest req, AuthService svc, CancellationToken ct) =>
            {
                if (string.IsNullOrWhiteSpace(req.RefreshToken))
                    return Results.BadRequest(new { error = "refreshToken required" });
                var response = await svc.RefreshAsync(req.RefreshToken, ct);
                return response is null ? Results.Unauthorized() : Results.Ok(response);
            })
            .WithName("RefreshToken")
            .Produces<AuthResponse>();

        group.MapPost("/logout",
            async (LogoutRequest req, AuthService svc, CancellationToken ct) =>
            {
                if (!string.IsNullOrWhiteSpace(req.RefreshToken))
                    await svc.LogoutAsync(req.RefreshToken, ct);
                return Results.NoContent();
            })
            .WithName("Logout")
            .Produces(StatusCodes.Status204NoContent);

        // ── Google OAuth (popup flow) ─────────────────────────────────────────

        group.MapPost("/google",
            async (GoogleAuthRequest req, AuthService svc, OAuthService oauth, CancellationToken ct) =>
            {
                if (string.IsNullOrWhiteSpace(req.IdToken))
                    return Results.BadRequest(new { error = "idToken required" });

                var info = await oauth.ValidateGoogleAsync(req.IdToken, ct);
                if (info is null) return Results.Unauthorized();

                var response = await svc.LoginWithOAuthAsync(info, ct);
                return response is null ? Results.StatusCode(500) : Results.Ok(response);
            })
            .WithName("GoogleLogin")
            .RequireRateLimiting("login")
            .Produces<AuthResponse>();

        // ── Facebook OAuth (popup flow) ───────────────────────────────────────

        group.MapPost("/facebook",
            async (FacebookAuthRequest req, AuthService svc, OAuthService oauth, CancellationToken ct) =>
            {
                if (string.IsNullOrWhiteSpace(req.AccessToken))
                    return Results.BadRequest(new { error = "accessToken required" });

                var info = await oauth.ValidateFacebookAsync(req.AccessToken, ct);
                if (info is null) return Results.Unauthorized();

                var response = await svc.LoginWithOAuthAsync(info, ct);
                return response is null ? Results.StatusCode(500) : Results.Ok(response);
            })
            .WithName("FacebookLogin")
            .RequireRateLimiting("login")
            .Produces<AuthResponse>();

        // ── Twitter / X OAuth 2.0 PKCE (redirect flow) ───────────────────────

        group.MapGet("/twitter",
            (HttpContext ctx, OAuthService oauth, IOptions<NotesApiOptions> opts) =>
            {
                var callbackUrl = $"{ctx.Request.Scheme}://{ctx.Request.Host}/auth/twitter/callback";
                var (authUrl, _) = oauth.BuildTwitterAuthUrl(callbackUrl);
                return Results.Redirect(authUrl);
            })
            .WithName("TwitterLogin")
            .ExcludeFromDescription();

        group.MapGet("/twitter/callback",
            async (string? code, string? state, string? error,
                   HttpContext ctx, AuthService svc, OAuthService oauth,
                   IOptions<NotesApiOptions> opts, CancellationToken ct) =>
            {
                var frontend = opts.Value.FrontendBaseUrl;
                if (!string.IsNullOrEmpty(error) || string.IsNullOrEmpty(code) || string.IsNullOrEmpty(state))
                    return Results.Redirect($"{frontend}/?auth_error=twitter_denied");

                var callbackUrl = $"{ctx.Request.Scheme}://{ctx.Request.Host}/auth/twitter/callback";
                var info = await oauth.ExchangeTwitterCodeAsync(code, state, callbackUrl, ct);
                if (info is null)
                    return Results.Redirect($"{frontend}/?auth_error=twitter_failed");

                var response = await svc.LoginWithOAuthAsync(info, ct);
                if (response is null)
                    return Results.Redirect($"{frontend}/?auth_error=twitter_failed");

                // Pass tokens to frontend via query params (HTTPS only in prod — acceptable for short-lived access token)
                var at = Uri.EscapeDataString(response.AccessToken);
                var rt = Uri.EscapeDataString(response.RefreshToken);
                var dn = Uri.EscapeDataString(response.User.DisplayName);
                var id = Uri.EscapeDataString(response.User.Id.ToString());
                var em = Uri.EscapeDataString(response.User.Email);
                return Results.Redirect($"{frontend}/#notes_at={at}&notes_rt={rt}&notes_dn={dn}&notes_id={id}&notes_em={em}");
            })
            .WithName("TwitterCallback")
            .ExcludeFromDescription();

        return app;
    }
}
