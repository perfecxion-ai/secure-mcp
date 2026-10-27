export enum SecurityLevel {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical'
}

export interface SeccompProfile {
  defaultAction: string;
  architectures: string[];
  syscalls: Array<{
    names: string[];
    action: string;
  }>;
}

export class SeccompProfileManager {
  static async createSeccompProfile(level: SecurityLevel): Promise<SeccompProfile> {
    const baseProfile: SeccompProfile = {
      defaultAction: 'SCMP_ACT_ERRNO',
      architectures: ['SCMP_ARCH_X86_64', 'SCMP_ARCH_AARCH64'],
      syscalls: []
    };

    switch (level) {
      case SecurityLevel.LOW:
        baseProfile.syscalls = [
          { names: ['read', 'write', 'open', 'close', 'stat'], action: 'SCMP_ACT_ALLOW' }
        ];
        break;
      case SecurityLevel.MEDIUM:
        baseProfile.syscalls = [
          { names: ['read', 'write', 'open', 'close'], action: 'SCMP_ACT_ALLOW' }
        ];
        break;
      case SecurityLevel.HIGH:
        baseProfile.syscalls = [
          { names: ['read', 'write'], action: 'SCMP_ACT_ALLOW' }
        ];
        break;
      case SecurityLevel.CRITICAL:
        baseProfile.defaultAction = 'SCMP_ACT_KILL';
        baseProfile.syscalls = [
          { names: ['exit', 'exit_group'], action: 'SCMP_ACT_ALLOW' }
        ];
        break;
    }

    return baseProfile;
  }

  static async writeProfileToFile(profile: SeccompProfile, filePath: string): Promise<void> {
    const fs = await import('fs/promises');
    const path = await import('path');

    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(profile, null, 2));
  }
}