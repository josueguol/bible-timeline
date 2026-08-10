using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Serialization;
using BibleTimeline.NotesApi.Models;
using BibleTimeline.NotesApi.Options;
using Google.Apis.Auth;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Options;

namespace BibleTimeline.NotesApi.Services;

public sealed class OAuthService(
    IHttpClientFactory httpFactory,
    IMemoryCache cache,
    IOptions<NotesApiOptions> options)
{
    private readonly NotesApiOptions _opts = options.Value;

    // ── Google ────────────────────────────────────────────────────────────────

    public async Task<OAuthUserInfo?> ValidateGoogleAsync(string idToken, CancellationToken ct)
    {
        try
        {
            var payload = await GoogleJsonWebSignature.ValidateAsync(idToken,
                new GoogleJsonWebSignature.ValidationSettings
                {
                    Audience = [_opts.GoogleClientId],
                });
            return new OAuthUserInfo("google", payload.Subject, payload.Email, payload.Name);
        }
        catch { return null; }
    }

    // ── Facebook ──────────────────────────────────────────────────────────────

    public async Task<OAuthUserInfo?> ValidateFacebookAsync(string accessToken, CancellationToken ct)
    {
        var client = httpFactory.CreateClient("oauth");

        // Verify token belongs to our app
        var appToken = $"{_opts.FacebookAppId}|{_opts.FacebookAppSecret}";
        try
        {
            var debug = await client.GetFromJsonAsync<FbDebugResponse>(
                $"https://graph.facebook.com/debug_token?input_token={Uri.EscapeDataString(accessToken)}&access_token={Uri.EscapeDataString(appToken)}",
                ct);
            if (debug?.Data?.IsValid != true || debug.Data.AppId != _opts.FacebookAppId)
                return null;

            var me = await client.GetFromJsonAsync<FbMeResponse>(
                $"https://graph.facebook.com/me?fields=id,name,email&access_token={Uri.EscapeDataString(accessToken)}",
                ct);
            if (me?.Id is null) return null;

            return new OAuthUserInfo("facebook", me.Id, me.Email, me.Name);
        }
        catch { return null; }
    }

    // ── Twitter / X (OAuth 2.0 PKCE, server-side redirect) ───────────────────

    public (string AuthUrl, string State) BuildTwitterAuthUrl(string callbackUrl)
    {
        var state    = B64Url(RandomNumberGenerator.GetBytes(16));
        var verifier = B64Url(RandomNumberGenerator.GetBytes(32));
        var challenge = B64Url(SHA256.HashData(Encoding.ASCII.GetBytes(verifier)));

        cache.Set($"tw:{state}", verifier, TimeSpan.FromMinutes(10));

        var url = "https://twitter.com/i/oauth2/authorize" +
            $"?response_type=code" +
            $"&client_id={Uri.EscapeDataString(_opts.TwitterClientId)}" +
            $"&redirect_uri={Uri.EscapeDataString(callbackUrl)}" +
            $"&scope=users.read" +
            $"&state={state}" +
            $"&code_challenge={challenge}" +
            $"&code_challenge_method=S256";

        return (url, state);
    }

    public async Task<OAuthUserInfo?> ExchangeTwitterCodeAsync(
        string code, string state, string callbackUrl, CancellationToken ct)
    {
        if (!cache.TryGetValue($"tw:{state}", out string? verifier) || verifier is null)
            return null;
        cache.Remove($"tw:{state}");

        var client = httpFactory.CreateClient("oauth");

        // Exchange code → access token
        var basic = Convert.ToBase64String(
            Encoding.UTF8.GetBytes($"{_opts.TwitterClientId}:{_opts.TwitterClientSecret}"));
        client.DefaultRequestHeaders.Authorization =
            new System.Net.Http.Headers.AuthenticationHeaderValue("Basic", basic);

        var tokenResp = await client.PostAsync(
            "https://api.twitter.com/2/oauth2/token",
            new FormUrlEncodedContent(new Dictionary<string, string>
            {
                ["code"]           = code,
                ["grant_type"]     = "authorization_code",
                ["redirect_uri"]   = callbackUrl,
                ["code_verifier"]  = verifier,
            }), ct);

        if (!tokenResp.IsSuccessStatusCode) return null;

        var token = await tokenResp.Content.ReadFromJsonAsync<TwitterTokenResponse>(ct);
        if (token?.AccessToken is null) return null;

        // Get user info
        client.DefaultRequestHeaders.Authorization =
            new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token.AccessToken);

        var me = await client.GetFromJsonAsync<TwitterMeResponse>(
            "https://api.twitter.com/2/users/me?user.fields=name,username",
            ct);
        if (me?.Data?.Id is null) return null;

        var displayName = me.Data.Name ?? $"@{me.Data.Username}";
        var placeholderEmail = $"twitter.{me.Data.Id}@oauth.internal";

        return new OAuthUserInfo("twitter", me.Data.Id, placeholderEmail, displayName);
    }

    private static string B64Url(byte[] bytes)
        => Convert.ToBase64String(bytes).Replace('+', '-').Replace('/', '_').TrimEnd('=');

    // ── Internal response shapes ──────────────────────────────────────────────

    private sealed class FbDebugResponse
    {
        [JsonPropertyName("data")] public FbDebugData? Data { get; init; }
    }
    private sealed class FbDebugData
    {
        [JsonPropertyName("is_valid")] public bool   IsValid { get; init; }
        [JsonPropertyName("app_id")]   public string? AppId  { get; init; }
    }
    private sealed class FbMeResponse
    {
        [JsonPropertyName("id")]    public string? Id    { get; init; }
        [JsonPropertyName("name")]  public string? Name  { get; init; }
        [JsonPropertyName("email")] public string? Email { get; init; }
    }
    private sealed class TwitterTokenResponse
    {
        [JsonPropertyName("access_token")] public string? AccessToken { get; init; }
    }
    private sealed class TwitterMeResponse
    {
        [JsonPropertyName("data")] public TwitterUser? Data { get; init; }
    }
    private sealed class TwitterUser
    {
        [JsonPropertyName("id")]       public string? Id       { get; init; }
        [JsonPropertyName("name")]     public string? Name     { get; init; }
        [JsonPropertyName("username")] public string? Username { get; init; }
    }
}
