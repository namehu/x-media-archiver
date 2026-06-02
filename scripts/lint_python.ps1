$compose = @("docker", "compose")
docker compose version *> $null
if ($LASTEXITCODE -ne 0) {
    docker-compose version *> $null
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Neither 'docker compose' nor 'docker-compose' is available."
        exit 127
    }
    $compose = @("docker-compose")
}

& $compose[0] @($compose[1..($compose.Length - 1)] + @("run", "--rm", "--no-deps", "--entrypoint", "python", "xarchiver", "-m", "ruff", "check", "--config", "/app/pyproject.toml", "/app/xarchiver", "/app/tests"))
