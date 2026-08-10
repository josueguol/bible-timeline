using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using BibleTimeline.NotesApi.Options;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;

namespace BibleTimeline.NotesApi.Services;

public sealed class TokenService(IOptions<NotesApiOptions> options)
{
    private readonly NotesApiOptions _opts = options.Value;

    public string GenerateAccessToken(Guid userId, string email, string displayName)
    {
        var key   = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_opts.JwtSecret));
        var creds = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);

        var claims = new[]
        {
            new Claim(JwtRegisteredClaimNames.Sub,   userId.ToString()),
            new Claim(JwtRegisteredClaimNames.Email, email),
            new Claim(JwtRegisteredClaimNames.Name,  displayName),
            new Claim(JwtRegisteredClaimNames.Jti,   Guid.NewGuid().ToString()),
        };

        var token = new JwtSecurityToken(
            issuer:             _opts.JwtIssuer,
            audience:           _opts.JwtAudience,
            claims:             claims,
            expires:            DateTime.UtcNow.AddMinutes(_opts.AccessTokenExpiryMinutes),
            signingCredentials: creds);

        return new JwtSecurityTokenHandler().WriteToken(token);
    }

    public (string Raw, string Hash) GenerateRefreshToken()
    {
        var raw  = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32));
        var hash = HashRaw(raw);
        return (raw, hash);
    }

    public static string HashRaw(string raw)
        => Convert.ToBase64String(SHA256.HashData(Encoding.UTF8.GetBytes(raw)));
}
