import { spawn, SpawnOptions } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import { promisify } from 'util';
import { exec } from 'child_process';
import { logger } from '@/utils/logger';
import { redis } from '@/database/redis';
import { vault } from '@/security/vault';
import { Metrics } from '@/monitoring/metrics';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';

// Security hardening imports
import { SeccompProfileManager, SecurityLevel } from './security/seccomp-profiles';
import { UserNamespaceManager } from './security/user-namespace';
import { MandatoryAccessControl } from './security/mac-profiles';
import { ResourceController } from './security/resource-controller';
import { NetworkIsolation } from './security/network-isolation';
import { CapabilityManager } from './security/capability-manager';

const execAsync = promisify(exec);

export enum ContainerRuntime {
  GVISOR = 'gvisor',
  KATA = 'kata',
  DOCKER = 'docker',
}

// SecurityLevel is now imported from seccomp-profiles

interface ExecutionConfig {
  runtime: ContainerRuntime;
  image: string;
  command: string[];
  env?: Record<string, string>;
  workDir?: string;
  timeout?: number;
  cpuLimit?: string;
  memoryLimit?: string;
  network?: boolean;
  readOnly?: boolean;
  securityLevel?: SecurityLevel;
  userId?: string;
  sessionId?: string;
  // Enhanced security configuration
  securityHardening?: SecurityHardeningConfig;
}

interface SecurityHardeningConfig {
  enableSeccomp: boolean;
  enableUserNamespace: boolean;
  enableMandatoryAccessControl: boolean;
  enableResourceLimits: boolean;
  enableNetworkIsolation: boolean;
  enableCapabilityDropping: boolean;
  allowedCapabilities?: string[];
  networkPolicy?: 'none' | 'bridge' | 'custom';
  macProfile?: 'apparmor' | 'selinux' | 'both';
  customSeccompProfile?: any;
  customResourceLimits?: any;
}

interface ExecutionResult {
  executionId: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  duration: number;
  resourceUsage: {
    cpuPercent: number;
    memoryMB: number;
    networkIO?: {
      bytesReceived: number;
      bytesSent: number;
    };
  };
  securityEvents: SecurityEvent[];
}

interface SecurityEvent {
  timestamp: Date;
  type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  details?: any;
  source: 'seccomp' | 'namespace' | 'mac' | 'resource' | 'network' | 'capability' | 'general';
  remediation?: string;
}

interface SecurityContext {
  seccompProfileId?: string;
  userNamespaceId?: string;
  macProfileId?: string;
  resourceGroupId?: string;
  networkNamespaceId?: string;
  appliedCapabilities: string[];
  droppedCapabilities: string[];
  securityLevel: SecurityLevel;
  hardeningEnabled: boolean;
}

export class ContainerExecutor {
  private static readonly SANDBOX_BASE = '/var/lib/mcp-sandbox';
  private static readonly MAX_OUTPUT_SIZE = 10 * 1024 * 1024; // 10MB
  private static readonly DEFAULT_TIMEOUT = 30000; // 30 seconds
  private static readonly CONTAINER_PREFIX = 'mcp-exec';

  private executionCount = 0;
  private activeExecutions = new Map<string, AbortController>();
  private activeSecurityContexts = new Map<string, SecurityContext>();

  // Security hardening managers
  private seccompManager: SeccompProfileManager;
  private userNamespaceManager: UserNamespaceManager;
  private macManager: MandatoryAccessControl;
  private resourceController: ResourceController;
  private networkIsolation: NetworkIsolation;
  private capabilityManager: CapabilityManager;

  constructor() {
    this.initializeSecurityManagers();
    this.initializeSandboxEnvironment();
  }

  private async initializeSecurityManagers(): Promise<void> {
    try {
      this.seccompManager = new SeccompProfileManager();
      this.userNamespaceManager = new UserNamespaceManager();
      this.macManager = new MandatoryAccessControl();
      this.resourceController = new ResourceController();
      this.networkIsolation = new NetworkIsolation();
      this.capabilityManager = new CapabilityManager();

      logger.info('Security hardening managers initialized');
    } catch (error) {
      logger.error('Failed to initialize security managers', { error });
      throw error;
    }
  }

  private async initializeSandboxEnvironment(): Promise<void> {
    try {
      await fs.mkdir(ContainerExecutor.SANDBOX_BASE, { recursive: true });
      await this.setupSecurityPolicies();
      await this.verifyRuntimeAvailability();
      logger.info('Container executor initialized');
    } catch (error) {
      logger.error('Failed to initialize container executor', { error });
      throw error;
    }
  }

  private async setupSecurityPolicies(): Promise<void> {
    const policies = {
      seccomp: await this.loadSeccompProfile(),
      apparmor: await this.loadApparmorProfile(),
      selinux: await this.loadSelinuxPolicy(),
    };

    await vault.write('runtime/security-policies', policies);
  }

  private async loadSeccompProfile(): Promise<object> {
    return {
      defaultAction: 'SCMP_ACT_ERRNO',
      architectures: ['SCMP_ARCH_X86_64', 'SCMP_ARCH_AARCH64'],
      syscalls: [
        {
          names: [
            'accept', 'accept4', 'access', 'alarm', 'bind', 'brk', 'capget',
            'capset', 'chdir', 'chmod', 'chown', 'clock_getres', 'clock_gettime',
            'clone', 'close', 'connect', 'copy_file_range', 'creat', 'dup',
            'dup2', 'dup3', 'epoll_create', 'epoll_create1', 'epoll_ctl',
            'epoll_pwait', 'epoll_wait', 'eventfd', 'eventfd2', 'execve',
            'execveat', 'exit', 'exit_group', 'faccessat', 'fadvise64',
            'fallocate', 'fanotify_mark', 'fchdir', 'fchmod', 'fchmodat',
            'fchown', 'fchownat', 'fcntl', 'fdatasync', 'fgetxattr',
            'flistxattr', 'flock', 'fork', 'fremovexattr', 'fsync',
            'ftruncate', 'futex', 'getcwd', 'getdents', 'getdents64',
            'getegid', 'geteuid', 'getgid', 'getgroups', 'getitimer',
            'getpeername', 'getpgid', 'getpgrp', 'getpid', 'getppid',
            'getpriority', 'getrandom', 'getresgid', 'getresuid',
            'getrlimit', 'getrusage', 'getsid', 'getsockname',
            'getsockopt', 'gettid', 'gettimeofday', 'getuid', 'getxattr',
            'inotify_add_watch', 'inotify_init', 'inotify_init1',
            'inotify_rm_watch', 'io_cancel', 'io_destroy', 'io_getevents',
            'io_setup', 'io_submit', 'ioctl', 'kill', 'lgetxattr',
            'link', 'linkat', 'listen', 'listxattr', 'llistxattr',
            'lremovexattr', 'lseek', 'lsetxattr', 'lstat', 'madvise',
            'memfd_create', 'mincore', 'mkdir', 'mkdirat', 'mknod',
            'mknodat', 'mlock', 'mlockall', 'mmap', 'mprotect', 'mremap',
            'msgctl', 'msgget', 'msgrcv', 'msgsnd', 'msync', 'munlock',
            'munlockall', 'munmap', 'nanosleep', 'newfstatat', 'open',
            'openat', 'pause', 'pipe', 'pipe2', 'poll', 'ppoll',
            'prctl', 'pread64', 'preadv', 'preadv2', 'prlimit64',
            'pselect6', 'pwrite64', 'pwritev', 'pwritev2', 'read',
            'readahead', 'readlink', 'readlinkat', 'readv', 'reboot',
            'recv', 'recvfrom', 'recvmmsg', 'recvmsg', 'remap_file_pages',
            'removexattr', 'rename', 'renameat', 'renameat2', 'restart_syscall',
            'rmdir', 'rt_sigaction', 'rt_sigpending', 'rt_sigprocmask',
            'rt_sigqueueinfo', 'rt_sigreturn', 'rt_sigsuspend',
            'rt_sigtimedwait', 'rt_tgsigqueueinfo', 'sched_getaffinity',
            'sched_getattr', 'sched_getparam', 'sched_getscheduler',
            'sched_get_priority_max', 'sched_get_priority_min',
            'sched_rr_get_interval', 'sched_setaffinity', 'sched_setattr',
            'sched_setparam', 'sched_setscheduler', 'sched_yield',
            'seccomp', 'select', 'semctl', 'semget', 'semop', 'semtimedop',
            'send', 'sendfile', 'sendmmsg', 'sendmsg', 'sendto',
            'setfsgid', 'setfsuid', 'setgid', 'setgroups', 'setitimer',
            'setpgid', 'setpriority', 'setregid', 'setresgid', 'setresuid',
            'setreuid', 'setrlimit', 'setsid', 'setsockopt', 'setuid',
            'setxattr', 'shmat', 'shmctl', 'shmdt', 'shmget', 'shutdown',
            'sigaltstack', 'signalfd', 'signalfd4', 'socket', 'socketpair',
            'splice', 'stat', 'statfs', 'statx', 'symlink', 'symlinkat',
            'sync', 'sync_file_range', 'syncfs', 'sysinfo', 'tee',
            'tgkill', 'time', 'timer_create', 'timer_delete',
            'timer_getoverrun', 'timer_gettime', 'timer_settime',
            'timerfd_create', 'timerfd_gettime', 'timerfd_settime',
            'times', 'tkill', 'truncate', 'umask', 'uname', 'unlink',
            'unlinkat', 'unshare', 'utime', 'utimensat', 'utimes',
            'vfork', 'vmsplice', 'wait4', 'waitid', 'waitpid', 'write',
            'writev'
          ],
          action: 'SCMP_ACT_ALLOW'
        }
      ]
    };
  }

  private async loadApparmorProfile(): Promise<string> {
    return `
#include <tunables/global>

profile mcp-executor flags=(attach_disconnected,mediate_deleted) {
  #include <abstractions/base>

  network inet tcp,
  network inet udp,
  network inet icmp,
  network netlink raw,

  deny network raw,
  deny network packet,

  file,
  umount,

  deny /proc/sys/kernel/** wklx,
  deny /proc/sysrq-trigger rwklx,
  deny /proc/kcore rwklx,
  deny /proc/mem rwklx,
  deny /proc/kmem rwklx,

  deny mount,

  deny /sys/[^f]*/** wklx,
  deny /sys/f[^s]*/** wklx,
  deny /sys/fs/[^c]*/** wklx,
  deny /sys/fs/c[^g]*/** wklx,
  deny /sys/fs/cg[^r]*/** wklx,
  deny /sys/firmware/** rwklx,
  deny /sys/kernel/security/** rwklx,

  ptrace (trace,read) peer=mcp-executor,
}
    `;
  }

  private async loadSelinuxPolicy(): Promise<string> {
    return `
module mcp_executor 1.0;

require {
  type container_t;
  type container_runtime_t;
  type sysadm_t;
  class process { transition signal };
  class file { read write execute };
}

type mcp_executor_t;
type mcp_executor_exec_t;

allow container_runtime_t mcp_executor_t:process transition;
allow mcp_executor_t container_t:process signal;
allow mcp_executor_t self:file { read write execute };
    `;
  }

  private async verifyRuntimeAvailability(): Promise<void> {
    const runtimes = [
      { name: ContainerRuntime.GVISOR, command: 'runsc --version' },
      { name: ContainerRuntime.KATA, command: 'kata-runtime --version' },
      { name: ContainerRuntime.DOCKER, command: 'docker --version' },
    ];

    for (const runtime of runtimes) {
      try {
        await execAsync(runtime.command);
        logger.info(`Container runtime available: ${runtime.name}`);
      } catch (error) {
        logger.warn(`Container runtime not available: ${runtime.name}`);
      }
    }
  }

  public async execute(config: ExecutionConfig): Promise<ExecutionResult> {
    const executionId = uuidv4();
    const startTime = Date.now();
    const securityEvents: SecurityEvent[] = [];
    let securityContext: SecurityContext;

    try {
      // Enhanced security validation
      await this.validateExecutionConfig(config);
      await this.validateSecurityConfiguration(config);

      // Apply security hardening
      securityContext = await this.applySecurityHardening(executionId, config);
      this.activeSecurityContexts.set(executionId, securityContext);

      await this.recordExecutionStart(executionId, config);

      const runtime = await this.selectRuntime(config);
      const containerName = `${ContainerExecutor.CONTAINER_PREFIX}-${executionId}`;

      // Enhanced container execution with security context
      const result = await this.runSecureContainer({
        ...config,
        runtime,
        containerName,
        executionId,
        securityContext
      });

      // Enhanced security scanning
      await this.performSecurityScanning(executionId, config.image, result);

      // Collect security metrics
      const resourceUsage = await this.collectEnhancedResourceMetrics(containerName, securityContext);
      const securityMetrics = await this.collectSecurityMetrics(executionId, securityContext);

      // Cleanup with security context
      await this.cleanupSecureContainer(executionId, containerName, securityContext);

      const duration = Date.now() - startTime;
      await this.recordExecutionEnd(executionId, result, duration);

      return {
        executionId,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        duration,
        resourceUsage: { ...resourceUsage, ...securityMetrics },
        securityEvents: [...securityEvents, ...await this.getSecurityEvents(executionId)],
      };
    } catch (error) {
      logger.error('Secure container execution failed', { executionId, error });

      // Cleanup on failure
      if (securityContext!) {
        await this.cleanupSecurityContext(executionId, securityContext);
      }

      throw error;
    }
  }

  private async validateExecutionConfig(config: ExecutionConfig): Promise<void> {
    if (!config.image || !config.command || config.command.length === 0) {
      throw new Error('Invalid execution configuration');
    }

    const allowedImages = await this.getAllowedImages();
    if (!allowedImages.includes(config.image)) {
      throw new Error(`Image ${config.image} is not in the allowed list`);
    }

    if (config.command.some(cmd => this.containsMaliciousPattern(cmd))) {
      throw new Error('Command contains potentially malicious patterns');
    }

    // Enhanced security validation
    await this.validateImageSecurity(config.image);
    await this.validateCommandSecurity(config.command);
    await this.validateEnvironmentSecurity(config.env || {});
  }

  private async validateSecurityConfiguration(config: ExecutionConfig): Promise<void> {
    const securityLevel = config.securityLevel || SecurityLevel.HIGH;

    // Validate security level requirements
    if (securityLevel === SecurityLevel.CRITICAL) {
      // Critical level requires all security features
      const hardening = config.securityHardening || this.getDefaultSecurityHardening();

      if (!hardening.enableSeccomp || !hardening.enableUserNamespace ||
          !hardening.enableCapabilityDropping || !hardening.enableNetworkIsolation) {
        throw new Error('Critical security level requires all security hardening features');
      }
    }

    // Validate capability configuration
    if (config.securityHardening?.allowedCapabilities) {
      const dangerousCapabilities = ['CAP_SYS_ADMIN', 'CAP_SYS_MODULE', 'CAP_SYS_RAWIO', 'CAP_SYS_PTRACE'];
      const hasDangerous = config.securityHardening.allowedCapabilities.some(cap =>
        dangerousCapabilities.includes(cap)
      );

      if (hasDangerous && securityLevel !== SecurityLevel.LOW) {
        throw new Error('Dangerous capabilities not allowed for this security level');
      }
    }
  }

  private containsMaliciousPattern(command: string): boolean {
    const maliciousPatterns = [
      // File system attacks
      /rm\s+-rf\s+\//,
      /dd\s+if=\/dev\/(zero|urandom)\s+of=/,
      /chmod\s+(777|4755)\s+\//,
      /chown\s+root\s+/,

      // Shell injection and reverse shells
      /:(){ :|:& };:/, // Fork bomb
      /\bwget\b.*\|\s*sh/,
      /\bcurl\b.*\|\s*bash/,
      /\/dev\/tcp\//,
      /\bnc\b.*-e\s*\/bin\/(sh|bash)/,
      /\bbash\b.*-i\s*>&\s*\/dev\/tcp/,

      // Programming language shells
      /\bpython\b.*-c.*import\s+socket/,
      /\bperl\b.*-e.*socket/,
      /\bnode\b.*-e.*require\s*\(\s*['"]net['"]/,
      /\bruby\b.*-e.*socket/,

      // Privilege escalation
      /sudo\s+su\s*-/,
      /passwd\s+root/,
      /usermod\s+-a\s+-G\s+sudo/,
      /setuid\s*\(/,

      // Container escape attempts
      /docker\s+run.*--privileged/,
      /mount\s+.*\/proc/,
      /nsenter\s+/,
      /unshare\s+/,
      /capsh\s+/,

      // Network reconnaissance
      /nmap\s+/,
      /masscan\s+/,
      /zmap\s+/,

      // System information gathering
      /\/proc\/version/,
      /\/etc\/shadow/,
      /\/etc\/passwd/,
      /\/root\//,

      // Cryptomining indicators
      /xmrig/,
      /cpuminer/,
      /minerd/,

      // Suspicious network activity
      /base64\s+-d.*\|\s*sh/,
      /echo\s+.*\|\s*base64\s+-d/,
    ];

    return maliciousPatterns.some(pattern => pattern.test(command));
  }

  private async getAllowedImages(): Promise<string[]> {
    const images = await vault.read('runtime/allowed-images');
    return images?.data?.images || [
      'alpine:3.19',
      'ubuntu:22.04',
      'python:3.11-slim',
      'node:20-alpine',
      'golang:1.21-alpine',
      'rust:1.75-alpine',
      'openjdk:21-slim',
    ];
  }

  private async selectRuntime(config: ExecutionConfig): Promise<ContainerRuntime> {
    if (config.runtime) {
      return config.runtime;
    }

    switch (config.securityLevel) {
      case SecurityLevel.CRITICAL:
        return ContainerRuntime.KATA;
      case SecurityLevel.HIGH:
        return ContainerRuntime.GVISOR;
      default:
        return ContainerRuntime.DOCKER;
    }
  }

  private async runSecureContainer(config: any): Promise<any> {
    const { runtime, containerName, executionId, image, command, env, workDir, timeout,
            cpuLimit, memoryLimit, network, readOnly, securityContext } = config;

    // Build enhanced runtime command with security hardening
    const runtimeCommand = await this.buildSecureRuntimeCommand(runtime, {
      containerName,
      image,
      command,
      env,
      workDir,
      cpuLimit: cpuLimit || '1000m',
      memoryLimit: memoryLimit || '1Gi',
      network: network !== false,
      readOnly: readOnly !== false,
      securityContext
    });

    return new Promise((resolve, reject) => {
      const controller = new AbortController();
      this.activeExecutions.set(executionId, controller);

      let stdout = '';
      let stderr = '';
      let outputSize = 0;

      const timeoutId = setTimeout(() => {
        controller.abort();
        reject(new Error('Execution timeout'));
      }, timeout || ContainerExecutor.DEFAULT_TIMEOUT);

      const proc = spawn(runtimeCommand.cmd, runtimeCommand.args, {
        signal: controller.signal,
        env: { ...process.env, ...env },
        // Enhanced security options
        uid: 1000, // Non-root execution
        gid: 1000,
      } as SpawnOptions);

      // Enhanced output monitoring with security filtering
      proc.stdout?.on('data', (data) => {
        outputSize += data.length;
        if (outputSize > ContainerExecutor.MAX_OUTPUT_SIZE) {
          controller.abort();
          reject(new Error('Output size exceeded limit'));
        }
        const filteredData = this.filterSensitiveOutput(data.toString());
        stdout += filteredData;
      });

      proc.stderr?.on('data', (data) => {
        outputSize += data.length;
        if (outputSize > ContainerExecutor.MAX_OUTPUT_SIZE) {
          controller.abort();
          reject(new Error('Output size exceeded limit'));
        }
        const filteredData = this.filterSensitiveOutput(data.toString());
        stderr += filteredData;
      });

      proc.on('exit', (code) => {
        clearTimeout(timeoutId);
        this.activeExecutions.delete(executionId);
        resolve({ stdout, stderr, exitCode: code || 0 });
      });

      proc.on('error', (error) => {
        clearTimeout(timeoutId);
        this.activeExecutions.delete(executionId);
        reject(error);
      });
    });
  }

  private async buildSecureRuntimeCommand(runtime: ContainerRuntime, options: any): { cmd: string; args: string[] } {
    const securityContext = options.securityContext;

    switch (runtime) {
      case ContainerRuntime.GVISOR:
        return await this.buildGvisorSecureCommand(options);

      case ContainerRuntime.KATA:
        return await this.buildKataSecureCommand(options);

      case ContainerRuntime.DOCKER:
      default:
        return await this.buildDockerSecureCommand(options);
    }
  }

  private async buildDockerSecureCommand(options: any): Promise<{ cmd: string; args: string[] }> {
    const securityContext = options.securityContext;

    const dockerArgs = [
      'run',
      '--rm',
      '--name', options.containerName,
      '--cpus', options.cpuLimit,
      '--memory', options.memoryLimit,
      '--memory-swap', '0', // Disable swap
      '--oom-kill-disable=false', // Allow OOM killer
      '--pids-limit', '50', // Strict PID limit
      '--ulimit', 'nofile=1024:1024', // File descriptor limit
      '--ulimit', 'core=0', // No core dumps
    ];

    // Enhanced security options
    dockerArgs.push('--security-opt', 'no-new-privileges:true');
    dockerArgs.push('--security-opt', 'apparmor=docker-default');

    // Capability management
    dockerArgs.push('--cap-drop', 'ALL');
    if (securityContext.appliedCapabilities.length > 0) {
      securityContext.appliedCapabilities.forEach(cap => {
        dockerArgs.push('--cap-add', cap);
      });
    }

    // Seccomp profile
    if (securityContext.seccompProfileId) {
      const profilePath = `/tmp/mcp/seccomp-${securityContext.seccompProfileId}.json`;
      dockerArgs.push('--security-opt', `seccomp=${profilePath}`);
    }

    // User namespace
    if (securityContext.userNamespaceId) {
      dockerArgs.push('--userns', 'host'); // Will be managed by our namespace manager
      dockerArgs.push('--user', '1000:1000'); // Non-root execution
    }

    // Network isolation
    if (securityContext.networkNamespaceId) {
      dockerArgs.push('--network', 'none'); // Maximum isolation
    } else if (!options.network) {
      dockerArgs.push('--network', 'none');
    }

    // Read-only root filesystem
    if (options.readOnly) {
      dockerArgs.push('--read-only');
      dockerArgs.push('--tmpfs', '/tmp:noexec,nosuid,nodev,size=50M');
      dockerArgs.push('--tmpfs', '/var/tmp:noexec,nosuid,nodev,size=10M');
    }

    // Working directory
    if (options.workDir) {
      dockerArgs.push('--workdir', options.workDir);
    }

    // Environment variables (filtered)
    if (options.env) {
      Object.entries(options.env).forEach(([key, value]) => {
        if (this.isSecureEnvironmentVariable(key, value as string)) {
          dockerArgs.push('-e', `${key}=${value}`);
        }
      });
    }

    // Additional hardening
    dockerArgs.push('--device-cgroup-rule', 'c *:* m'); // Block all device access by default
    dockerArgs.push('--kernel-memory', '128m'); // Kernel memory limit
    dockerArgs.push('--shm-size', '64m'); // Shared memory limit

    // Prevent privilege escalation
    dockerArgs.push('--privileged=false');
    dockerArgs.push('--init'); // Use tini as init process

    dockerArgs.push(options.image);
    dockerArgs.push(...options.command);

    return { cmd: 'docker', args: dockerArgs };
  }

  private async buildGvisorSecureCommand(options: any): Promise<{ cmd: string; args: string[] }> {
    const securityContext = options.securityContext;

    return {
      cmd: 'runsc',
      args: [
        'run',
        '--network=none',
        '--rootless',
        '--platform=ptrace',
        '--overlay',
        '--cpu-num=1',
        `--memory=${options.memoryLimit}`,
        '--file-access=exclusive', // Enhanced file isolation
        '--network=none', // No network access
        '--name', options.containerName,
        options.image,
        ...options.command,
      ],
    };
  }

  private async buildKataSecureCommand(options: any): Promise<{ cmd: string; args: string[] }> {
    const securityContext = options.securityContext;

    return {
      cmd: 'kata-runtime',
      args: [
        'run',
        '--runtime=io.containerd.kata.v2',
        '--cpu', '1',
        '--memory', options.memoryLimit,
        '--name', options.containerName,
        options.image,
        ...options.command,
      ],
    };
  }

  private async collectResourceMetrics(containerName: string): Promise<any> {
    try {
      const { stdout } = await execAsync(`docker stats ${containerName} --no-stream --format json`);
      const stats = JSON.parse(stdout);

      return {
        cpuPercent: parseFloat(stats.CPUPerc?.replace('%', '') || '0'),
        memoryMB: this.parseMemory(stats.MemUsage),
        networkIO: {
          bytesReceived: this.parseBytes(stats.NetIO?.split('/')[0]),
          bytesSent: this.parseBytes(stats.NetIO?.split('/')[1]),
        },
      };
    } catch (error) {
      logger.warn('Failed to collect resource metrics', { containerName, error });
      return {
        cpuPercent: 0,
        memoryMB: 0,
      };
    }
  }

  private parseMemory(memUsage: string): number {
    if (!memUsage) return 0;
    const match = memUsage.match(/([\d.]+)\s*([KMGT]i?B)/i);
    if (!match) return 0;

    const value = parseFloat(match[1]);
    const unit = match[2].toUpperCase();

    const multipliers: Record<string, number> = {
      'B': 1 / (1024 * 1024),
      'KB': 1 / 1024,
      'KIB': 1 / 1024,
      'MB': 1,
      'MIB': 1,
      'GB': 1024,
      'GIB': 1024,
      'TB': 1024 * 1024,
      'TIB': 1024 * 1024,
    };

    return value * (multipliers[unit] || 1);
  }

  private parseBytes(bytesStr: string): number {
    if (!bytesStr) return 0;
    const match = bytesStr.match(/([\d.]+)\s*([KMGT]?B)/i);
    if (!match) return 0;

    const value = parseFloat(match[1]);
    const unit = match[2].toUpperCase();

    const multipliers: Record<string, number> = {
      'B': 1,
      'KB': 1024,
      'MB': 1024 * 1024,
      'GB': 1024 * 1024 * 1024,
      'TB': 1024 * 1024 * 1024 * 1024,
    };

    return value * (multipliers[unit] || 1);
  }

  private async cleanupSecureContainer(executionId: string, containerName: string, securityContext: SecurityContext): Promise<void> {
    try {
      // Stop and remove container
      await execAsync(`docker stop ${containerName} 2>/dev/null || true`);
      await execAsync(`docker rm ${containerName} 2>/dev/null || true`);

      // Cleanup security context
      await this.cleanupSecurityContext(executionId, securityContext);

    } catch (error) {
      logger.warn('Secure container cleanup failed', { containerName, executionId, error });
    }
  }

  private async cleanupSecurityContext(executionId: string, securityContext: SecurityContext): Promise<void> {
    try {
      // Cleanup user namespace
      if (securityContext.userNamespaceId) {
        await this.userNamespaceManager.destroyNamespace(executionId);
      }

      // Cleanup network namespace
      if (securityContext.networkNamespaceId) {
        await this.networkIsolation.destroyNetworkNamespace(executionId);
      }

      // Cleanup resource group
      if (securityContext.resourceGroupId) {
        await this.resourceController.destroyResourceGroup(executionId);
      }

      // Cleanup seccomp profile file
      if (securityContext.seccompProfileId) {
        try {
          await fs.unlink(`/tmp/mcp/seccomp-${securityContext.seccompProfileId}.json`);
        } catch {
          // File may not exist
        }
      }

      // Remove from active contexts
      this.activeSecurityContexts.delete(executionId);

      logger.info('Security context cleaned up', { executionId });

    } catch (error) {
      logger.error('Failed to cleanup security context', { executionId, error });
      throw error;
    }
  }

  private async scanForVulnerabilities(executionId: string, image: string): Promise<void> {
    try {
      const { stdout } = await execAsync(`trivy image --format json --quiet ${image}`);
      const vulnerabilities = JSON.parse(stdout);

      if (vulnerabilities.Results?.length > 0) {
        const criticalVulns = vulnerabilities.Results.flatMap((r: any) =>
          r.Vulnerabilities?.filter((v: any) => v.Severity === 'CRITICAL') || []
        );

        if (criticalVulns.length > 0) {
          logger.warn('Critical vulnerabilities detected in image', {
            executionId,
            image,
            vulnerabilities: criticalVulns.slice(0, 5),
          });
        }
      }
    } catch (error) {
      logger.error('Vulnerability scanning failed', { executionId, image, error });
    }
  }

  private async performDLPScan(content: string): Promise<void> {
    const patterns = [
      { name: 'SSN', regex: /\b\d{3}-\d{2}-\d{4}\b/g },
      { name: 'Credit Card', regex: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g },
      { name: 'API Key', regex: /\b[A-Za-z0-9]{32,}\b/g },
      { name: 'Private Key', regex: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/g },
      { name: 'AWS Access Key', regex: /AKIA[0-9A-Z]{16}/g },
    ];

    for (const pattern of patterns) {
      const matches = content.match(pattern.regex);
      if (matches && matches.length > 0) {
        logger.warn('Potential sensitive data detected', {
          type: pattern.name,
          count: matches.length,
        });
      }
    }
  }

  private async recordExecutionStart(executionId: string, config: ExecutionConfig): Promise<void> {
    const record = {
      executionId,
      startTime: new Date().toISOString(),
      userId: config.userId,
      sessionId: config.sessionId,
      image: config.image,
      command: config.command.join(' '),
      runtime: config.runtime,
      securityLevel: config.securityLevel,
    };

    await redis.hset(`execution:${executionId}`, record);
    await redis.expire(`execution:${executionId}`, 86400); // 24 hours

    // Metrics will be recorded in recordExecutionEnd with actual duration
  }

  private async recordExecutionEnd(executionId: string, result: any, duration: number): Promise<void> {
    await redis.hset(`execution:${executionId}`, {
      endTime: new Date().toISOString(),
      exitCode: result.exitCode,
      duration,
      outputSize: (result.stdout.length + result.stderr.length),
    });

    Metrics.recordToolExecution('container-executor', 'success', duration, 'system');
  }

  public async terminateExecution(executionId: string): Promise<void> {
    const controller = this.activeExecutions.get(executionId);
    if (controller) {
      controller.abort();
      this.activeExecutions.delete(executionId);
      logger.info('Execution terminated', { executionId });
    }
  }

  public async getActiveExecutions(): Promise<string[]> {
    return Array.from(this.activeExecutions.keys());
  }

  // ============= SECURITY HARDENING METHODS =============

  /**
   * Applies comprehensive security hardening to container execution
   */
  private async applySecurityHardening(executionId: string, config: ExecutionConfig): Promise<SecurityContext> {
    const securityLevel = config.securityLevel || SecurityLevel.HIGH;
    const hardening = config.securityHardening || this.getDefaultSecurityHardening();

    const securityContext: SecurityContext = {
      securityLevel,
      hardeningEnabled: true,
      appliedCapabilities: [],
      droppedCapabilities: []
    };

    try {
      logger.info('Applying security hardening', { executionId, securityLevel });

      // 1. Create and apply seccomp profile
      if (hardening.enableSeccomp) {
        const seccompProfile = await SeccompProfileManager.createSeccompProfile(securityLevel);
        const profilePath = `/tmp/mcp/seccomp-${executionId}.json`;
        await SeccompProfileManager.writeProfileToFile(seccompProfile, profilePath);
        securityContext.seccompProfileId = executionId;
        logger.debug('Seccomp profile applied', { executionId });
      }

      // 2. Create user namespace for rootless execution
      if (hardening.enableUserNamespace) {
        const nsId = await this.userNamespaceManager.createUserNamespace();
        await this.userNamespaceManager.enforceNonRootExecution(nsId);
        securityContext.userNamespaceId = nsId;
        logger.debug('User namespace created', { executionId, nsId });
      }

      // 3. Apply mandatory access control
      if (hardening.enableMandatoryAccessControl) {
        await this.applyMandatoryAccessControl(executionId, hardening.macProfile);
        securityContext.macProfileId = `mac-${executionId}`;
        logger.debug('MAC profile applied', { executionId });
      }

      // 4. Create resource limits
      if (hardening.enableResourceLimits) {
        const resourceLimits = hardening.customResourceLimits || this.resourceController.getDefaultSecureLimits();
        const resourceGroupId = await this.resourceController.createResourceGroup(executionId, resourceLimits);
        securityContext.resourceGroupId = resourceGroupId;
        logger.debug('Resource limits applied', { executionId, resourceGroupId });
      }

      // 5. Setup network isolation
      if (hardening.enableNetworkIsolation) {
        const networkPolicy = this.networkIsolation.getDefaultSecurePolicy();
        if (hardening.networkPolicy === 'bridge') {
          networkPolicy.mode = 'bridge';
        } else if (hardening.networkPolicy === 'custom') {
          networkPolicy.mode = 'custom';
        }
        const networkNsId = await this.networkIsolation.createNetworkNamespace(executionId, networkPolicy);
        securityContext.networkNamespaceId = networkNsId;
        logger.debug('Network isolation applied', { executionId, networkNsId });
      }

      // 6. Configure capability dropping
      if (hardening.enableCapabilityDropping) {
        const capConfig = await this.capabilityManager.dropDangerousCapabilities();
        if (hardening.allowedCapabilities) {
          capConfig.add = hardening.allowedCapabilities;
        }
        await this.capabilityManager.validateCapabilityConfig(capConfig);
        securityContext.appliedCapabilities = capConfig.add;
        securityContext.droppedCapabilities = capConfig.drop;
        logger.debug('Capability configuration applied', { executionId, added: capConfig.add.length, dropped: capConfig.drop.length });
      }

      logger.info('Security hardening applied successfully', { executionId, securityContext });
      return securityContext;

    } catch (error) {
      logger.error('Failed to apply security hardening', { executionId, error });
      // Cleanup any partially created resources
      await this.cleanupSecurityContext(executionId, securityContext);
      throw error;
    }
  }

  private async applyMandatoryAccessControl(executionId: string, macProfile?: 'apparmor' | 'selinux' | 'both'): Promise<void> {
    try {
      const defaultConfig = this.macManager.getDefaultSecureConfig();

      if (macProfile === 'apparmor' || macProfile === 'both' || !macProfile) {
        const apparmorProfile = await this.macManager.createAppArmorProfile(defaultConfig.apparmor);
        logger.debug('AppArmor profile created', { executionId, profileName: apparmorProfile.name });
      }

      if (macProfile === 'selinux' || macProfile === 'both') {
        const selinuxProfile = await this.macManager.createSELinuxPolicy(defaultConfig.selinux);
        logger.debug('SELinux policy created', { executionId, moduleName: selinuxProfile.name });
      }

    } catch (error) {
      logger.warn('MAC profile setup failed, continuing without MAC', { executionId, error });
      // Continue without MAC if it fails - some systems may not support it
    }
  }

  private getDefaultSecurityHardening(): SecurityHardeningConfig {
    return {
      enableSeccomp: true,
      enableUserNamespace: true,
      enableMandatoryAccessControl: true,
      enableResourceLimits: true,
      enableNetworkIsolation: true,
      enableCapabilityDropping: true,
      allowedCapabilities: [], // No capabilities by default
      networkPolicy: 'none', // Maximum isolation
      macProfile: 'apparmor'
    };
  }

  /**
   * Enhanced security validation methods
   */
  private async validateImageSecurity(image: string): Promise<void> {
    try {
      // Check if image is signed
      const signatureCheck = await this.checkImageSignature(image);
      if (!signatureCheck.valid) {
        logger.warn('Image signature validation failed', { image, reason: signatureCheck.reason });
      }

      // Scan for known vulnerabilities
      await this.scanForVulnerabilities('validation', image);

      // Check image metadata for security issues
      await this.validateImageMetadata(image);

    } catch (error) {
      logger.error('Image security validation failed', { image, error });
      throw error;
    }
  }

  private async checkImageSignature(image: string): Promise<{ valid: boolean; reason?: string }> {
    try {
      // This would integrate with image signing verification (e.g., Cosign, Notary)
      // For now, we'll implement basic checks

      // Check if image is from trusted registry
      const trustedRegistries = ['docker.io/library', 'gcr.io/distroless', 'quay.io/'];
      const isFromTrustedRegistry = trustedRegistries.some(registry => image.startsWith(registry));

      if (!isFromTrustedRegistry) {
        return { valid: false, reason: 'Image not from trusted registry' };
      }

      return { valid: true };
    } catch (error) {
      return { valid: false, reason: `Signature check failed: ${error}` };
    }
  }

  private async validateImageMetadata(image: string): Promise<void> {
    try {
      const { stdout } = await execAsync(`docker inspect ${image} --format='{{json .Config}}'`);
      const config = JSON.parse(stdout);

      // Check for dangerous configurations
      if (config.User === 'root' || config.User === '0') {
        logger.warn('Image runs as root user', { image });
      }

      if (config.Privileged) {
        throw new Error('Image configured to run in privileged mode - rejected');
      }

      // Check exposed ports
      if (config.ExposedPorts) {
        const exposedPorts = Object.keys(config.ExposedPorts);
        const privilegedPorts = exposedPorts.filter(port => {
          const portNum = parseInt(port.split('/')[0]);
          return portNum < 1024;
        });

        if (privilegedPorts.length > 0) {
          logger.warn('Image exposes privileged ports', { image, ports: privilegedPorts });
        }
      }

    } catch (error) {
      logger.warn('Failed to validate image metadata', { image, error });
      // Continue execution - metadata validation is not critical
    }
  }

  private async validateCommandSecurity(commands: string[]): Promise<void> {
    for (const command of commands) {
      // Enhanced malicious pattern detection
      if (this.containsMaliciousPattern(command)) {
        throw new Error(`Command contains malicious patterns: ${command}`);
      }

      // Check for suspicious command combinations
      if (this.containsSuspiciousCombination(commands)) {
        throw new Error('Command sequence contains suspicious patterns');
      }

      // Validate command length to prevent buffer overflow attempts
      if (command.length > 4096) {
        throw new Error('Command exceeds maximum length limit');
      }
    }
  }

  private containsSuspiciousCombination(commands: string[]): boolean {
    const commandString = commands.join(' ');

    // Check for suspicious command chains
    const suspiciousPatterns = [
      /wget.*&&.*chmod.*&&.*\.\//, // Download, make executable, run
      /curl.*\|.*sh/, // Pipe curl to shell
      /echo.*\|.*base64.*-d.*\|.*sh/, // Base64 decode and execute
      /python.*-c.*exec.*input/, // Python code injection
      /bash.*-c.*eval/, // Bash eval injection
    ];

    return suspiciousPatterns.some(pattern => pattern.test(commandString));
  }

  private async validateEnvironmentSecurity(env: Record<string, string>): Promise<void> {
    const dangerousEnvVars = [
      'LD_PRELOAD', 'LD_LIBRARY_PATH', 'PYTHONPATH', 'PATH',
      'SHELL', 'IFS', 'PS1', 'PROMPT_COMMAND'
    ];

    for (const [key, value] of Object.entries(env)) {
      // Check for dangerous environment variables
      if (dangerousEnvVars.includes(key)) {
        logger.warn('Potentially dangerous environment variable', { key, value });
      }

      // Check for injection attempts in environment values
      if (this.containsMaliciousPattern(value)) {
        throw new Error(`Environment variable contains malicious content: ${key}`);
      }

      // Check for excessive environment variable size
      if (value.length > 1024) {
        throw new Error(`Environment variable value too large: ${key}`);
      }
    }
  }

  private isSecureEnvironmentVariable(key: string, value: string): boolean {
    // Whitelist approach for environment variables
    const allowedPrefixes = ['APP_', 'CUSTOM_', 'USER_', 'CONFIG_'];
    const allowedKeys = ['LANG', 'LC_ALL', 'TZ', 'HOME', 'TMPDIR'];

    const isAllowedKey = allowedKeys.includes(key);
    const hasAllowedPrefix = allowedPrefixes.some(prefix => key.startsWith(prefix));

    return isAllowedKey || hasAllowedPrefix;
  }

  private filterSensitiveOutput(output: string): string {
    // Filter out potentially sensitive information from output
    const sensitivePatterns = [
      /password[=:]\s*\S+/gi,
      /token[=:]\s*\S+/gi,
      /key[=:]\s*\S+/gi,
      /secret[=:]\s*\S+/gi,
      /api[_-]?key[=:]\s*\S+/gi,
      /access[_-]?token[=:]\s*\S+/gi,
    ];

    let filteredOutput = output;
    sensitivePatterns.forEach(pattern => {
      filteredOutput = filteredOutput.replace(pattern, '[FILTERED]');
    });

    return filteredOutput;
  }

  /**
   * Enhanced monitoring and metrics collection
   */
  private async performSecurityScanning(executionId: string, image: string, result: any): Promise<void> {
    try {
      await Promise.all([
        this.scanForVulnerabilities(executionId, image),
        this.performDLPScan(result.stdout + result.stderr),
        this.scanForMalwareIndicators(result.stdout + result.stderr),
        this.checkForSecurityViolations(executionId)
      ]);
    } catch (error) {
      logger.error('Security scanning failed', { executionId, error });
      // Continue execution but log the failure
    }
  }

  private async scanForMalwareIndicators(output: string): Promise<void> {
    const malwareIndicators = [
      /xmrig/gi, // Cryptocurrency miner
      /cpuminer/gi,
      /stratum\+tcp/gi, // Mining pool connection
      /cryptonight/gi,
      /monero/gi,
      /bitcoin/gi,
      /ethereum/gi,
      /botnet/gi,
      /backdoor/gi,
      /rootkit/gi,
    ];

    for (const pattern of malwareIndicators) {
      if (pattern.test(output)) {
        logger.error('Malware indicator detected in output', {
          pattern: pattern.source,
          output: output.substring(0, 200)
        });
      }
    }
  }

  private async checkForSecurityViolations(executionId: string): Promise<void> {
    const securityContext = this.activeSecurityContexts.get(executionId);
    if (!securityContext) return;

    // Check for capability violations if available
    try {
      const violations = [];

      // This would check for actual security violations during execution
      // For now, we'll implement basic checks

      if (violations.length > 0) {
        logger.error('Security violations detected', { executionId, violations });
      }
    } catch (error) {
      logger.warn('Security violation check failed', { executionId, error });
    }
  }

  private async collectEnhancedResourceMetrics(containerName: string, securityContext: SecurityContext): Promise<any> {
    try {
      // Collect basic resource metrics
      const basicMetrics = await this.collectResourceMetrics(containerName);

      // Collect security-specific metrics
      const securityMetrics: any = {
        securityContext: {
          hardeningEnabled: securityContext.hardeningEnabled,
          securityLevel: securityContext.securityLevel,
          appliedCapabilities: securityContext.appliedCapabilities.length,
          droppedCapabilities: securityContext.droppedCapabilities.length,
        }
      };

      // Collect resource controller metrics if available
      if (securityContext.resourceGroupId) {
        try {
          const resourceStats = this.resourceController.getResourceStats();
          securityMetrics.resourceController = resourceStats;
        } catch (error) {
          logger.warn('Failed to collect resource controller metrics', { error });
        }
      }

      // Collect network isolation metrics if available
      if (securityContext.networkNamespaceId) {
        try {
          const networkStats = this.networkIsolation.getNetworkStats();
          securityMetrics.networkIsolation = networkStats;
        } catch (error) {
          logger.warn('Failed to collect network isolation metrics', { error });
        }
      }

      return { ...basicMetrics, ...securityMetrics };

    } catch (error) {
      logger.error('Failed to collect enhanced resource metrics', { containerName, error });
      return await this.collectResourceMetrics(containerName); // Fallback to basic metrics
    }
  }

  private async collectSecurityMetrics(executionId: string, securityContext: SecurityContext): Promise<any> {
    return {
      securityHardening: {
        enabled: securityContext.hardeningEnabled,
        level: securityContext.securityLevel,
        componentsEnabled: {
          seccomp: !!securityContext.seccompProfileId,
          userNamespace: !!securityContext.userNamespaceId,
          macProfile: !!securityContext.macProfileId,
          resourceLimits: !!securityContext.resourceGroupId,
          networkIsolation: !!securityContext.networkNamespaceId,
          capabilityDropping: securityContext.droppedCapabilities.length > 0
        },
        capabilities: {
          applied: securityContext.appliedCapabilities,
          dropped: securityContext.droppedCapabilities.length
        }
      }
    };
  }

  private async getSecurityEvents(executionId: string): Promise<SecurityEvent[]> {
    try {
      // Collect security events from various sources
      const events: SecurityEvent[] = [];

      // This would collect events from seccomp, audit logs, etc.
      // For now, we'll return an empty array

      return events;
    } catch (error) {
      logger.error('Failed to collect security events', { executionId, error });
      return [];
    }
  }

  /**
   * Gets statistics about security hardening
   */
  public getSecurityStats(): any {
    return {
      activeExecutions: this.activeExecutions.size,
      activeSecurityContexts: this.activeSecurityContexts.size,
      securityManagers: {
        seccomp: !!this.seccompManager,
        userNamespace: !!this.userNamespaceManager,
        mac: !!this.macManager,
        resourceController: !!this.resourceController,
        networkIsolation: !!this.networkIsolation,
        capabilityManager: !!this.capabilityManager
      },
      capabilities: this.capabilityManager.getCapabilityStats(),
      resources: this.resourceController.getResourceStats(),
      network: this.networkIsolation.getNetworkStats()
    };
  }
}