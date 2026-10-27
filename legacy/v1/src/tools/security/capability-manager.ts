export interface CapabilitySet {
  allowed: string[];
  dropped: string[];
  add?: string[];
  drop?: string[];
}

export class CapabilityManager {
  static readonly DANGEROUS_CAPABILITIES = [
    'SYS_ADMIN',
    'SYS_MODULE',
    'SYS_RAWIO',
    'SYS_PTRACE',
    'SYS_BOOT',
    'SYS_TIME',
    'NET_ADMIN',
    'DAC_OVERRIDE',
    'SETUID',
    'SETGID'
  ];

  static readonly SAFE_CAPABILITIES = [
    'CHOWN',
    'DAC_OVERRIDE',
    'FOWNER',
    'FSETID',
    'KILL',
    'SETGID',
    'SETUID',
    'SETPCAP',
    'NET_BIND_SERVICE'
  ];

  static createSecureCapabilitySet(): CapabilitySet {
    return {
      allowed: ['NET_BIND_SERVICE'],
      dropped: this.DANGEROUS_CAPABILITIES
    };
  }

  static createMinimalCapabilitySet(): CapabilitySet {
    return {
      allowed: [],
      dropped: [...this.DANGEROUS_CAPABILITIES, ...this.SAFE_CAPABILITIES]
    };
  }

  static async applyCapabilities(containerId: string, capabilities: CapabilitySet): Promise<void> {
    // Mock implementation - would apply capabilities to container
    console.log(`Applying capabilities to container ${containerId}:`, capabilities);
  }

  static validateCapabilitySet(capabilities: CapabilitySet): boolean {
    const hasUnsafeCapabilities = capabilities.allowed.some(cap =>
      this.DANGEROUS_CAPABILITIES.includes(cap)
    );

    return !hasUnsafeCapabilities;
  }

  static async dropDangerousCapabilities(): Promise<CapabilitySet> {
    const caps = this.createSecureCapabilitySet();
    return {
      ...caps,
      add: caps.allowed,
      drop: caps.dropped
    };
  }

  static async validateCapabilityConfig(capabilities: CapabilitySet): Promise<boolean> {
    return this.validateCapabilitySet(capabilities);
  }

  static async getCapabilityStats(containerId: string): Promise<any> {
    return {
      containerId,
      allowedCapabilities: ['NET_BIND_SERVICE'],
      droppedCapabilities: this.DANGEROUS_CAPABILITIES,
      effectiveCapabilities: ['NET_BIND_SERVICE']
    };
  }
}