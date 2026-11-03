export class CliError extends Error {
  constructor(
    message: string,
    readonly exitCode: number = 1,
  ) {
    super(message);
    this.name = "CliError";
  }
}

export class UsageError extends CliError {
  constructor(message: string) {
    super(message, 2);
    this.name = "UsageError";
  }
}

export class ConfigError extends CliError {
  constructor(message: string, exitCode: number = 1) {
    super(message, exitCode);
    this.name = "ConfigError";
  }
}

export class CancelledError extends CliError {
  constructor() {
    super("cancelled", 130);
    this.name = "CancelledError";
  }
}
