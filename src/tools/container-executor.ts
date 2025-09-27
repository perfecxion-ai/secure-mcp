import { spawn, SpawnOptions } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import { promisify } from 'util';
import { exec } from 'child_process';
import { logger } from '@/utils/logger';
import { redis } from '@/database/redis';
import { vault } from '@/security/vault';
import { metrics } from '@/monitoring/metrics';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';

const execAsync = promisify(exec);

export enum ContainerRuntime {
  GVISOR = 'gvisor',
  KATA = 'kata',
  DOCKER = 'docker',
}

export enum SecurityLevel {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

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
}

export class ContainerExecutor {
  private static readonly SANDBOX_BASE = '/var/lib/mcp-sandbox';
  private static readonly MAX_OUTPUT_SIZE = 10 * 1024 * 1024; // 10MB
  private static readonly DEFAULT_TIMEOUT = 30000; // 30 seconds
  private static readonly CONTAINER_PREFIX = 'mcp-exec';

  private executionCount = 0;
  private activeExecutions = new Map<string, AbortController>();

  constructor() {
    this.initializeSandboxEnvironment();
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

    try {
      await this.validateExecutionConfig(config);
      await this.recordExecutionStart(executionId, config);

      const runtime = await this.selectRuntime(config);
      const containerName = `${ContainerExecutor.CONTAINER_PREFIX}-${executionId}`;

      const result = await this.runContainer({
        ...config,
        runtime,
        containerName,
        executionId,
      });

      await this.scanForVulnerabilities(executionId, config.image);
      await this.performDLPScan(result.stdout + result.stderr);

      const resourceUsage = await this.collectResourceMetrics(containerName);
      await this.cleanupContainer(containerName);

      const duration = Date.now() - startTime;

      await this.recordExecutionEnd(executionId, result, duration);

      return {
        executionId,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        duration,
        resourceUsage,
        securityEvents,
      };
    } catch (error) {
      logger.error('Container execution failed', { executionId, error });
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
  }

  private containsMaliciousPattern(command: string): boolean {
    const maliciousPatterns = [
      /rm\s+-rf\s+\//,
      /:(){ :|:& };:/,
      /\bwget\b.*\|\s*sh/,
      /\bcurl\b.*\|\s*bash/,
      /\/dev\/tcp\//,
      /\bnc\b.*-e\s*\/bin\/(sh|bash)/,
      /\bpython\b.*-c.*import\s+socket/,
      /\bperl\b.*-e.*socket/,
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

  private async runContainer(config: any): Promise<any> {
    const { runtime, containerName, executionId, image, command, env, workDir, timeout, cpuLimit, memoryLimit, network, readOnly } = config;

    const runtimeCommand = this.buildRuntimeCommand(runtime, {
      containerName,
      image,
      command,
      env,
      workDir,
      cpuLimit: cpuLimit || '1000m',
      memoryLimit: memoryLimit || '1Gi',
      network: network !== false,
      readOnly: readOnly !== false,
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
      } as SpawnOptions);

      proc.stdout?.on('data', (data) => {
        outputSize += data.length;
        if (outputSize > ContainerExecutor.MAX_OUTPUT_SIZE) {
          controller.abort();
          reject(new Error('Output size exceeded limit'));
        }
        stdout += data.toString();
      });

      proc.stderr?.on('data', (data) => {
        outputSize += data.length;
        if (outputSize > ContainerExecutor.MAX_OUTPUT_SIZE) {
          controller.abort();
          reject(new Error('Output size exceeded limit'));
        }
        stderr += data.toString();
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

  private buildRuntimeCommand(runtime: ContainerRuntime, options: any): { cmd: string; args: string[] } {
    switch (runtime) {
      case ContainerRuntime.GVISOR:
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
            '--name', options.containerName,
            options.image,
            ...options.command,
          ],
        };

      case ContainerRuntime.KATA:
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

      case ContainerRuntime.DOCKER:
      default:
        const dockerArgs = [
          'run',
          '--rm',
          '--name', options.containerName,
          '--cpus', options.cpuLimit,
          '--memory', options.memoryLimit,
          '--memory-swap', options.memoryLimit,
          '--security-opt', 'no-new-privileges:true',
          '--cap-drop', 'ALL',
          '--pids-limit', '100',
        ];

        if (options.readOnly) {
          dockerArgs.push('--read-only');
          dockerArgs.push('--tmpfs', '/tmp:noexec,nosuid,size=100M');
        }

        if (!options.network) {
          dockerArgs.push('--network', 'none');
        }

        if (options.workDir) {
          dockerArgs.push('--workdir', options.workDir);
        }

        if (options.env) {
          Object.entries(options.env).forEach(([key, value]) => {
            dockerArgs.push('-e', `${key}=${value}`);
          });
        }

        dockerArgs.push(options.image);
        dockerArgs.push(...options.command);

        return { cmd: 'docker', args: dockerArgs };
    }
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

  private async cleanupContainer(containerName: string): Promise<void> {
    try {
      await execAsync(`docker stop ${containerName} 2>/dev/null || true`);
      await execAsync(`docker rm ${containerName} 2>/dev/null || true`);
    } catch (error) {
      logger.warn('Container cleanup failed', { containerName, error });
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

    metrics.recordExecution(config.runtime || ContainerRuntime.DOCKER);
  }

  private async recordExecutionEnd(executionId: string, result: any, duration: number): Promise<void> {
    await redis.hset(`execution:${executionId}`, {
      endTime: new Date().toISOString(),
      exitCode: result.exitCode,
      duration,
      outputSize: (result.stdout.length + result.stderr.length),
    });

    metrics.recordExecutionDuration(duration);
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
}