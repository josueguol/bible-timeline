using System.IO;

namespace BibleTimeline.Api.Tests;

/// <summary>
/// Resolves paths relative to the repository root regardless of where the test binary runs from.
/// The test project walks up from the assembly directory until it finds <c>bible-timeline.sln</c>.
/// </summary>
public static class TestPaths
{
    private static string? _repoRoot;

    public static string RepoRoot => _repoRoot ??= FindRepoRoot();

    public static string Combine(params string[] parts) => Path.Combine(new[] { RepoRoot }.Concat(parts).ToArray());

    private static string FindRepoRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null)
        {
            if (File.Exists(Path.Combine(dir.FullName, "bible-timeline.sln")))
            {
                return dir.FullName;
            }
            dir = dir.Parent;
        }
        throw new DirectoryNotFoundException("Could not locate bible-timeline.sln from test bin directory.");
    }
}
