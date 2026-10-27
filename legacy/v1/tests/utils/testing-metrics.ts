/**
 * Testing Metrics and Quality Assurance Framework
 *
 * Comprehensive framework for collecting, analyzing, and reporting on testing metrics
 * and quality assurance indicators across all testing dimensions.
 */

export interface TestMetrics {
  // Test Execution Metrics
  execution: {
    totalTests: number;
    passedTests: number;
    failedTests: number;
    skippedTests: number;
    duration: number;
    averageTestDuration: number;
    testSuiteCount: number;
    testFileCount: number;
  };

  // Test Coverage Metrics
  coverage: {
    linesCovered: number;
    totalLines: number;
    lineCoveragePercentage: number;
    branchesCovered: number;
    totalBranches: number;
    branchCoveragePercentage: number;
    functionsCovered: number;
    totalFunctions: number;
    functionCoveragePercentage: number;
    statementsCovered: number;
    totalStatements: number;
    statementCoveragePercentage: number;
    uncoveredLines: string[];
  };

  // Security Testing Metrics
  security: {
    vulnerabilityTests: number;
    criticalVulnerabilities: number;
    highVulnerabilities: number;
    mediumVulnerabilities: number;
    lowVulnerabilities: number;
    securityScore: number;
    aiSafetyScore: number;
    performanceSecurityScore: number;
    penetrationTestsPassed: number;
    penetrationTestsFailed: number;
    complianceTestsPassed: number;
    complianceTestsFailed: number;
  };

  // Performance Metrics
  performance: {
    averageResponseTime: number;
    p50ResponseTime: number;
    p95ResponseTime: number;
    p99ResponseTime: number;
    maxResponseTime: number;
    throughput: number;
    errorRate: number;
    memoryUsage: number;
    cpuUsage: number;
    resourceLeaks: number;
    performanceRegressions: number;
  };

  // Quality Metrics
  quality: {
    codeComplexity: number;
    maintainabilityIndex: number;
    technicalDebtRatio: number;
    bugDensity: number;
    testDensity: number;
    codeChurn: number;
    defectEscapeRate: number;
    testEffectiveness: number;
  };

  // Reliability Metrics
  reliability: {
    testStability: number;
    flakyTestCount: number;
    testRerunRate: number;
    meanTimeBetweenFailures: number;
    meanTimeToRecovery: number;
    availabilityPercentage: number;
    failureRate: number;
  };
}

export interface QualityKPIs {
  // Primary KPIs
  primary: {
    overallQualityScore: number;
    testPassRate: number;
    securityComplianceScore: number;
    performanceScore: number;
    reliabilityScore: number;
  };

  // Secondary KPIs
  secondary: {
    testCoverageScore: number;
    codeQualityScore: number;
    testEfficiencyScore: number;
    defectDensity: number;
    testAutomationRatio: number;
  };

  // Trending KPIs
  trending: {
    qualityTrend: 'improving' | 'stable' | 'declining';
    coverageTrend: 'improving' | 'stable' | 'declining';
    performanceTrend: 'improving' | 'stable' | 'declining';
    securityTrend: 'improving' | 'stable' | 'declining';
  };

  // Targets and Thresholds
  targets: {
    minimumTestPassRate: number;
    minimumCoveragePercentage: number;
    maximumCriticalVulnerabilities: number;
    maximumHighVulnerabilities: number;
    minimumSecurityScore: number;
    maximumResponseTime: number;
    minimumPerformanceScore: number;
  };
}

export interface TestingReport {
  metadata: {
    timestamp: string;
    buildNumber: string;
    branch: string;
    commit: string;
    environment: string;
    reportType: 'daily' | 'build' | 'release' | 'ad-hoc';
  };

  summary: {
    overallStatus: 'PASS' | 'FAIL' | 'WARNING';
    qualityGate: 'PASSED' | 'FAILED' | 'WARNING';
    criticalIssues: number;
    recommendations: string[];
  };

  metrics: TestMetrics;
  kpis: QualityKPIs;

  trends: {
    period: string;
    dataPoints: Array<{
      date: string;
      qualityScore: number;
      testPassRate: number;
      coveragePercentage: number;
      securityScore: number;
      performanceScore: number;
    }>;
  };

  recommendations: {
    immediate: string[];
    shortTerm: string[];
    longTerm: string[];
  };
}

export class TestingMetricsCollector {
  private metrics: TestMetrics;
  private historicalData: Array<{ timestamp: string; metrics: TestMetrics }> = [];

  constructor() {
    this.metrics = this.initializeMetrics();
  }

  private initializeMetrics(): TestMetrics {
    return {
      execution: {
        totalTests: 0,
        passedTests: 0,
        failedTests: 0,
        skippedTests: 0,
        duration: 0,
        averageTestDuration: 0,
        testSuiteCount: 0,
        testFileCount: 0,
      },
      coverage: {
        linesCovered: 0,
        totalLines: 0,
        lineCoveragePercentage: 0,
        branchesCovered: 0,
        totalBranches: 0,
        branchCoveragePercentage: 0,
        functionsCovered: 0,
        totalFunctions: 0,
        functionCoveragePercentage: 0,
        statementsCovered: 0,
        totalStatements: 0,
        statementCoveragePercentage: 0,
        uncoveredLines: [],
      },
      security: {
        vulnerabilityTests: 0,
        criticalVulnerabilities: 0,
        highVulnerabilities: 0,
        mediumVulnerabilities: 0,
        lowVulnerabilities: 0,
        securityScore: 0,
        aiSafetyScore: 0,
        performanceSecurityScore: 0,
        penetrationTestsPassed: 0,
        penetrationTestsFailed: 0,
        complianceTestsPassed: 0,
        complianceTestsFailed: 0,
      },
      performance: {
        averageResponseTime: 0,
        p50ResponseTime: 0,
        p95ResponseTime: 0,
        p99ResponseTime: 0,
        maxResponseTime: 0,
        throughput: 0,
        errorRate: 0,
        memoryUsage: 0,
        cpuUsage: 0,
        resourceLeaks: 0,
        performanceRegressions: 0,
      },
      quality: {
        codeComplexity: 0,
        maintainabilityIndex: 0,
        technicalDebtRatio: 0,
        bugDensity: 0,
        testDensity: 0,
        codeChurn: 0,
        defectEscapeRate: 0,
        testEffectiveness: 0,
      },
      reliability: {
        testStability: 0,
        flakyTestCount: 0,
        testRerunRate: 0,
        meanTimeBetweenFailures: 0,
        meanTimeToRecovery: 0,
        availabilityPercentage: 0,
        failureRate: 0,
      },
    };
  }

  async collectJestMetrics(jestResults: any): Promise<void> {
    if (!jestResults) return;

    // Extract execution metrics
    this.metrics.execution.totalTests = jestResults.numTotalTests || 0;
    this.metrics.execution.passedTests = jestResults.numPassedTests || 0;
    this.metrics.execution.failedTests = jestResults.numFailedTests || 0;
    this.metrics.execution.skippedTests = jestResults.numPendingTests || 0;
    this.metrics.execution.testSuiteCount = jestResults.numTotalTestSuites || 0;

    // Calculate durations
    if (jestResults.testResults) {
      const durations = jestResults.testResults.map((result: any) => result.perfStats?.runtime || 0);
      this.metrics.execution.duration = durations.reduce((sum: number, duration: number) => sum + duration, 0);
      this.metrics.execution.averageTestDuration = this.metrics.execution.totalTests > 0
        ? this.metrics.execution.duration / this.metrics.execution.totalTests
        : 0;
    }

    // Collect test file count
    this.metrics.execution.testFileCount = jestResults.testResults?.length || 0;
  }

  async collectCoverageMetrics(coverageData: any): Promise<void> {
    if (!coverageData) return;

    const coverage = coverageData.total || {};

    this.metrics.coverage.linesCovered = coverage.lines?.covered || 0;
    this.metrics.coverage.totalLines = coverage.lines?.total || 0;
    this.metrics.coverage.lineCoveragePercentage = coverage.lines?.pct || 0;

    this.metrics.coverage.branchesCovered = coverage.branches?.covered || 0;
    this.metrics.coverage.totalBranches = coverage.branches?.total || 0;
    this.metrics.coverage.branchCoveragePercentage = coverage.branches?.pct || 0;

    this.metrics.coverage.functionsCovered = coverage.functions?.covered || 0;
    this.metrics.coverage.totalFunctions = coverage.functions?.total || 0;
    this.metrics.coverage.functionCoveragePercentage = coverage.functions?.pct || 0;

    this.metrics.coverage.statementsCovered = coverage.statements?.covered || 0;
    this.metrics.coverage.totalStatements = coverage.statements?.total || 0;
    this.metrics.coverage.statementCoveragePercentage = coverage.statements?.pct || 0;

    // Collect uncovered lines
    if (coverageData.files) {
      this.metrics.coverage.uncoveredLines = [];
      for (const [filename, fileData] of Object.entries(coverageData.files)) {
        const uncoveredLines = this.extractUncoveredLines(fileData);
        if (uncoveredLines.length > 0) {
          this.metrics.coverage.uncoveredLines.push(`${filename}: ${uncoveredLines.join(', ')}`);
        }
      }
    }
  }

  private extractUncoveredLines(fileData: any): number[] {
    const uncovered: number[] = [];
    const statementMap = fileData.s || {};
    const statements = fileData.statementMap || {};

    for (const [stmtId, count] of Object.entries(statementMap)) {
      if (count === 0) {
        const statement = statements[stmtId];
        if (statement && statement.start) {
          uncovered.push(statement.start.line);
        }
      }
    }

    return [...new Set(uncovered)].sort((a, b) => a - b);
  }

  async collectSecurityMetrics(securityResults: any): Promise<void> {
    if (!securityResults) return;

    // Count vulnerability tests
    this.metrics.security.vulnerabilityTests = securityResults.totalTests || 0;

    // Count vulnerabilities by severity
    if (securityResults.results) {
      this.metrics.security.criticalVulnerabilities = securityResults.results
        .filter((r: any) => r.status === 'FAIL' && r.severity === 'CRITICAL').length;

      this.metrics.security.highVulnerabilities = securityResults.results
        .filter((r: any) => r.status === 'FAIL' && r.severity === 'HIGH').length;

      this.metrics.security.mediumVulnerabilities = securityResults.results
        .filter((r: any) => r.status === 'FAIL' && r.severity === 'MEDIUM').length;

      this.metrics.security.lowVulnerabilities = securityResults.results
        .filter((r: any) => r.status === 'FAIL' && r.severity === 'LOW').length;
    }

    // Security scores
    this.metrics.security.securityScore = securityResults.overallScore || 0;
    this.metrics.security.aiSafetyScore = securityResults.aiSafetyScore || 0;
    this.metrics.security.performanceSecurityScore = securityResults.performanceScore || 0;

    // Penetration test results
    this.metrics.security.penetrationTestsPassed = securityResults.penetrationTestsPassed || 0;
    this.metrics.security.penetrationTestsFailed = securityResults.penetrationTestsFailed || 0;

    // Compliance test results
    this.metrics.security.complianceTestsPassed = securityResults.complianceTestsPassed || 0;
    this.metrics.security.complianceTestsFailed = securityResults.complianceTestsFailed || 0;
  }

  async collectPerformanceMetrics(performanceResults: any): Promise<void> {
    if (!performanceResults) return;

    const responseTime = performanceResults.responseTime || {};
    this.metrics.performance.averageResponseTime = responseTime.avg || 0;
    this.metrics.performance.p50ResponseTime = responseTime.p50 || 0;
    this.metrics.performance.p95ResponseTime = responseTime.p95 || 0;
    this.metrics.performance.p99ResponseTime = responseTime.p99 || 0;
    this.metrics.performance.maxResponseTime = responseTime.max || 0;

    const throughput = performanceResults.throughput || {};
    this.metrics.performance.throughput = throughput.requestsPerSecond || 0;
    this.metrics.performance.errorRate = throughput.errorRate || 0;

    const resource = performanceResults.resource || {};
    this.metrics.performance.memoryUsage = resource.memoryUsage || 0;
    this.metrics.performance.cpuUsage = resource.cpuUsage || 0;

    this.metrics.performance.resourceLeaks = performanceResults.resourceLeaks || 0;
    this.metrics.performance.performanceRegressions = performanceResults.performanceRegressions || 0;
  }

  calculateQualityMetrics(): void {
    // Calculate test density (tests per 1000 lines of code)
    this.metrics.quality.testDensity = this.metrics.coverage.totalLines > 0
      ? (this.metrics.execution.totalTests / this.metrics.coverage.totalLines) * 1000
      : 0;

    // Calculate bug density (bugs per 1000 lines of code)
    const totalBugs = this.metrics.security.criticalVulnerabilities +
                     this.metrics.security.highVulnerabilities +
                     this.metrics.security.mediumVulnerabilities +
                     this.metrics.execution.failedTests;

    this.metrics.quality.bugDensity = this.metrics.coverage.totalLines > 0
      ? (totalBugs / this.metrics.coverage.totalLines) * 1000
      : 0;

    // Calculate test effectiveness
    this.metrics.quality.testEffectiveness = this.metrics.execution.totalTests > 0
      ? (this.metrics.execution.passedTests / this.metrics.execution.totalTests) * 100
      : 0;

    // Calculate defect escape rate
    const totalDefects = this.metrics.security.criticalVulnerabilities + this.metrics.security.highVulnerabilities;
    this.metrics.quality.defectEscapeRate = this.metrics.execution.totalTests > 0
      ? (totalDefects / this.metrics.execution.totalTests) * 100
      : 0;

    // Calculate test stability
    this.metrics.reliability.testStability = this.metrics.execution.totalTests > 0
      ? ((this.metrics.execution.totalTests - this.metrics.reliability.flakyTestCount) / this.metrics.execution.totalTests) * 100
      : 0;

    // Calculate failure rate
    this.metrics.reliability.failureRate = this.metrics.execution.totalTests > 0
      ? (this.metrics.execution.failedTests / this.metrics.execution.totalTests) * 100
      : 0;
  }

  calculateKPIs(): QualityKPIs {
    // Primary KPIs
    const testPassRate = this.metrics.execution.totalTests > 0
      ? (this.metrics.execution.passedTests / this.metrics.execution.totalTests) * 100
      : 0;

    const securityComplianceScore = this.calculateSecurityComplianceScore();
    const performanceScore = this.calculatePerformanceScore();
    const reliabilityScore = this.calculateReliabilityScore();
    const overallQualityScore = this.calculateOverallQualityScore(testPassRate, securityComplianceScore, performanceScore, reliabilityScore);

    // Secondary KPIs
    const testCoverageScore = (this.metrics.coverage.lineCoveragePercentage +
                              this.metrics.coverage.branchCoveragePercentage +
                              this.metrics.coverage.functionCoveragePercentage) / 3;

    const codeQualityScore = this.calculateCodeQualityScore();
    const testEfficiencyScore = this.calculateTestEfficiencyScore();
    const testAutomationRatio = 100; // Assuming all tests are automated

    // Trending (would need historical data)
    const trending = this.calculateTrends();

    // Targets and thresholds
    const targets = {
      minimumTestPassRate: 95,
      minimumCoveragePercentage: 80,
      maximumCriticalVulnerabilities: 0,
      maximumHighVulnerabilities: 2,
      minimumSecurityScore: 80,
      maximumResponseTime: 2000,
      minimumPerformanceScore: 70,
    };

    return {
      primary: {
        overallQualityScore,
        testPassRate,
        securityComplianceScore,
        performanceScore,
        reliabilityScore,
      },
      secondary: {
        testCoverageScore,
        codeQualityScore,
        testEfficiencyScore,
        defectDensity: this.metrics.quality.bugDensity,
        testAutomationRatio,
      },
      trending,
      targets,
    };
  }

  private calculateSecurityComplianceScore(): number {
    const maxDeductions = 100;
    let deductions = 0;

    // Critical vulnerabilities have maximum impact
    deductions += this.metrics.security.criticalVulnerabilities * 25;
    // High vulnerabilities have significant impact
    deductions += this.metrics.security.highVulnerabilities * 15;
    // Medium vulnerabilities have moderate impact
    deductions += this.metrics.security.mediumVulnerabilities * 5;
    // Low vulnerabilities have minimal impact
    deductions += this.metrics.security.lowVulnerabilities * 1;

    return Math.max(0, maxDeductions - deductions);
  }

  private calculatePerformanceScore(): number {
    let score = 100;

    // Response time impact
    if (this.metrics.performance.averageResponseTime > 2000) {
      score -= 20;
    } else if (this.metrics.performance.averageResponseTime > 1000) {
      score -= 10;
    }

    // Error rate impact
    if (this.metrics.performance.errorRate > 0.05) {
      score -= 20;
    } else if (this.metrics.performance.errorRate > 0.01) {
      score -= 10;
    }

    // Resource usage impact
    if (this.metrics.performance.memoryUsage > 1000000000) { // 1GB
      score -= 10;
    }

    return Math.max(0, score);
  }

  private calculateReliabilityScore(): number {
    let score = 100;

    // Test stability impact
    if (this.metrics.reliability.testStability < 95) {
      score -= 20;
    } else if (this.metrics.reliability.testStability < 98) {
      score -= 10;
    }

    // Flaky test impact
    if (this.metrics.reliability.flakyTestCount > 5) {
      score -= 15;
    } else if (this.metrics.reliability.flakyTestCount > 2) {
      score -= 10;
    }

    return Math.max(0, score);
  }

  private calculateOverallQualityScore(testPassRate: number, securityScore: number, performanceScore: number, reliabilityScore: number): number {
    // Weighted average of all scores
    const weights = {
      testPassRate: 0.3,
      securityScore: 0.3,
      performanceScore: 0.2,
      reliabilityScore: 0.2,
    };

    return (testPassRate * weights.testPassRate +
            securityScore * weights.securityScore +
            performanceScore * weights.performanceScore +
            reliabilityScore * weights.reliabilityScore);
  }

  private calculateCodeQualityScore(): number {
    let score = 100;

    // Coverage impact
    if (this.metrics.coverage.lineCoveragePercentage < 80) {
      score -= 20;
    } else if (this.metrics.coverage.lineCoveragePercentage < 90) {
      score -= 10;
    }

    // Bug density impact
    if (this.metrics.quality.bugDensity > 10) {
      score -= 20;
    } else if (this.metrics.quality.bugDensity > 5) {
      score -= 10;
    }

    return Math.max(0, score);
  }

  private calculateTestEfficiencyScore(): number {
    let score = 100;

    // Test execution time impact
    if (this.metrics.execution.averageTestDuration > 1000) {
      score -= 20;
    } else if (this.metrics.execution.averageTestDuration > 500) {
      score -= 10;
    }

    // Test effectiveness impact
    if (this.metrics.quality.testEffectiveness < 95) {
      score -= 15;
    } else if (this.metrics.quality.testEffectiveness < 98) {
      score -= 10;
    }

    return Math.max(0, score);
  }

  private calculateTrends(): QualityKPIs['trending'] {
    // For now, return stable trends (would need historical data for real calculation)
    return {
      qualityTrend: 'stable',
      coverageTrend: 'stable',
      performanceTrend: 'stable',
      securityTrend: 'stable',
    };
  }

  generateReport(buildInfo: { buildNumber: string; branch: string; commit: string; environment: string }): TestingReport {
    this.calculateQualityMetrics();
    const kpis = this.calculateKPIs();

    // Determine overall status
    const criticalIssues = this.metrics.security.criticalVulnerabilities;
    const highIssues = this.metrics.security.highVulnerabilities;
    const testFailures = this.metrics.execution.failedTests;

    let overallStatus: 'PASS' | 'FAIL' | 'WARNING' = 'PASS';
    let qualityGate: 'PASSED' | 'FAILED' | 'WARNING' = 'PASSED';

    if (criticalIssues > 0 || kpis.primary.testPassRate < 90) {
      overallStatus = 'FAIL';
      qualityGate = 'FAILED';
    } else if (highIssues > 2 || kpis.primary.testPassRate < 95) {
      overallStatus = 'WARNING';
      qualityGate = 'WARNING';
    }

    // Generate recommendations
    const recommendations = this.generateRecommendations(kpis);

    return {
      metadata: {
        timestamp: new Date().toISOString(),
        buildNumber: buildInfo.buildNumber,
        branch: buildInfo.branch,
        commit: buildInfo.commit,
        environment: buildInfo.environment,
        reportType: 'build',
      },
      summary: {
        overallStatus,
        qualityGate,
        criticalIssues,
        recommendations: recommendations.immediate,
      },
      metrics: this.metrics,
      kpis,
      trends: {
        period: 'last-30-days',
        dataPoints: [], // Would be populated with historical data
      },
      recommendations,
    };
  }

  private generateRecommendations(kpis: QualityKPIs): { immediate: string[]; shortTerm: string[]; longTerm: string[] } {
    const immediate: string[] = [];
    const shortTerm: string[] = [];
    const longTerm: string[] = [];

    // Immediate recommendations (critical issues)
    if (this.metrics.security.criticalVulnerabilities > 0) {
      immediate.push(`🚨 Address ${this.metrics.security.criticalVulnerabilities} critical security vulnerabilities immediately`);
    }

    if (kpis.primary.testPassRate < 90) {
      immediate.push(`🔧 Fix failing tests to achieve >90% pass rate (currently ${kpis.primary.testPassRate.toFixed(1)}%)`);
    }

    if (this.metrics.coverage.lineCoveragePercentage < 70) {
      immediate.push(`📊 Increase test coverage to >70% (currently ${this.metrics.coverage.lineCoveragePercentage.toFixed(1)}%)`);
    }

    // Short-term recommendations (high priority improvements)
    if (this.metrics.security.highVulnerabilities > 0) {
      shortTerm.push(`⚠️ Resolve ${this.metrics.security.highVulnerabilities} high-severity security vulnerabilities`);
    }

    if (kpis.secondary.testCoverageScore < 80) {
      shortTerm.push(`🎯 Improve overall test coverage to >80% (currently ${kpis.secondary.testCoverageScore.toFixed(1)}%)`);
    }

    if (this.metrics.performance.averageResponseTime > 1000) {
      shortTerm.push(`⚡ Optimize performance to achieve <1000ms average response time`);
    }

    if (this.metrics.reliability.flakyTestCount > 2) {
      shortTerm.push(`🔄 Fix ${this.metrics.reliability.flakyTestCount} flaky tests to improve reliability`);
    }

    // Long-term recommendations (strategic improvements)
    if (this.metrics.quality.testDensity < 5) {
      longTerm.push(`📈 Increase test density to >5 tests per 1000 lines of code`);
    }

    if (kpis.secondary.codeQualityScore < 85) {
      longTerm.push(`🏗️ Improve code quality through refactoring and technical debt reduction`);
    }

    longTerm.push(`📊 Implement continuous quality monitoring and alerting`);
    longTerm.push(`🎓 Establish quality training and best practices documentation`);

    return { immediate, shortTerm, longTerm };
  }

  getMetrics(): TestMetrics {
    return this.metrics;
  }

  storeHistoricalData(): void {
    this.historicalData.push({
      timestamp: new Date().toISOString(),
      metrics: { ...this.metrics },
    });

    // Keep only last 30 days of data
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    this.historicalData = this.historicalData.filter(
      entry => new Date(entry.timestamp) > thirtyDaysAgo
    );
  }

  exportMetrics(format: 'json' | 'csv' = 'json'): string {
    if (format === 'json') {
      return JSON.stringify(this.metrics, null, 2);
    } else {
      // CSV export implementation
      const csvRows: string[] = [];
      csvRows.push('Metric,Category,Value');

      // Flatten metrics for CSV
      for (const [category, categoryMetrics] of Object.entries(this.metrics)) {
        for (const [metric, value] of Object.entries(categoryMetrics)) {
          csvRows.push(`${metric},${category},${value}`);
        }
      }

      return csvRows.join('\n');
    }
  }
}

export class QualityAssuranceFramework {
  private metricsCollector: TestingMetricsCollector;
  private qualityGates: Map<string, (metrics: TestMetrics) => boolean>;

  constructor() {
    this.metricsCollector = new TestingMetricsCollector();
    this.qualityGates = new Map();
    this.setupDefaultQualityGates();
  }

  private setupDefaultQualityGates(): void {
    // Test execution quality gate
    this.qualityGates.set('test-execution', (metrics) => {
      const passRate = metrics.execution.totalTests > 0
        ? (metrics.execution.passedTests / metrics.execution.totalTests) * 100
        : 0;
      return passRate >= 95;
    });

    // Coverage quality gate
    this.qualityGates.set('test-coverage', (metrics) => {
      return metrics.coverage.lineCoveragePercentage >= 80 &&
             metrics.coverage.branchCoveragePercentage >= 75;
    });

    // Security quality gate
    this.qualityGates.set('security', (metrics) => {
      return metrics.security.criticalVulnerabilities === 0 &&
             metrics.security.highVulnerabilities <= 2;
    });

    // Performance quality gate
    this.qualityGates.set('performance', (metrics) => {
      return metrics.performance.averageResponseTime <= 2000 &&
             metrics.performance.errorRate <= 0.01;
    });

    // Reliability quality gate
    this.qualityGates.set('reliability', (metrics) => {
      return metrics.reliability.testStability >= 95 &&
             metrics.reliability.flakyTestCount <= 2;
    });
  }

  async runQualityAssessment(testResults: {
    jest?: any;
    coverage?: any;
    security?: any;
    performance?: any;
  }): Promise<TestingReport> {
    // Collect metrics from all sources
    if (testResults.jest) {
      await this.metricsCollector.collectJestMetrics(testResults.jest);
    }

    if (testResults.coverage) {
      await this.metricsCollector.collectCoverageMetrics(testResults.coverage);
    }

    if (testResults.security) {
      await this.metricsCollector.collectSecurityMetrics(testResults.security);
    }

    if (testResults.performance) {
      await this.metricsCollector.collectPerformanceMetrics(testResults.performance);
    }

    // Store historical data
    this.metricsCollector.storeHistoricalData();

    // Generate comprehensive report
    const buildInfo = {
      buildNumber: process.env.BUILD_NUMBER || 'local',
      branch: process.env.BRANCH_NAME || 'unknown',
      commit: process.env.COMMIT_SHA || 'unknown',
      environment: process.env.NODE_ENV || 'test',
    };

    return this.metricsCollector.generateReport(buildInfo);
  }

  evaluateQualityGates(): { gate: string; passed: boolean; description: string }[] {
    const metrics = this.metricsCollector.getMetrics();
    const results: { gate: string; passed: boolean; description: string }[] = [];

    for (const [gateName, gateFunction] of this.qualityGates) {
      const passed = gateFunction(metrics);
      results.push({
        gate: gateName,
        passed,
        description: this.getGateDescription(gateName),
      });
    }

    return results;
  }

  private getGateDescription(gateName: string): string {
    const descriptions = {
      'test-execution': 'All tests must pass with >95% success rate',
      'test-coverage': 'Code coverage must be >80% lines and >75% branches',
      'security': 'Zero critical vulnerabilities and ≤2 high vulnerabilities',
      'performance': 'Average response time ≤2000ms and error rate ≤1%',
      'reliability': 'Test stability >95% and ≤2 flaky tests',
    };

    return descriptions[gateName] || 'Quality gate evaluation';
  }

  addCustomQualityGate(name: string, evaluator: (metrics: TestMetrics) => boolean, description: string): void {
    this.qualityGates.set(name, evaluator);
  }

  getMetrics(): TestMetrics {
    return this.metricsCollector.getMetrics();
  }

  exportReport(report: TestingReport, format: 'json' | 'html' | 'pdf' = 'json'): string {
    switch (format) {
      case 'json':
        return JSON.stringify(report, null, 2);
      case 'html':
        return this.generateHTMLReport(report);
      case 'pdf':
        throw new Error('PDF export not implemented');
      default:
        throw new Error(`Unsupported format: ${format}`);
    }
  }

  private generateHTMLReport(report: TestingReport): string {
    // Basic HTML report template
    return `
<!DOCTYPE html>
<html>
<head>
    <title>Testing Quality Report</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .header { background: #f5f5f5; padding: 20px; border-radius: 5px; }
        .metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; margin: 20px 0; }
        .metric-card { border: 1px solid #ddd; padding: 15px; border-radius: 5px; }
        .status-pass { color: green; }
        .status-fail { color: red; }
        .status-warning { color: orange; }
    </style>
</head>
<body>
    <div class="header">
        <h1>Testing Quality Report</h1>
        <p><strong>Build:</strong> ${report.metadata.buildNumber}</p>
        <p><strong>Branch:</strong> ${report.metadata.branch}</p>
        <p><strong>Timestamp:</strong> ${report.metadata.timestamp}</p>
        <p><strong>Status:</strong> <span class="status-${report.summary.overallStatus.toLowerCase()}">${report.summary.overallStatus}</span></p>
    </div>

    <div class="metrics">
        <div class="metric-card">
            <h3>Test Execution</h3>
            <p>Total Tests: ${report.metrics.execution.totalTests}</p>
            <p>Passed: ${report.metrics.execution.passedTests}</p>
            <p>Failed: ${report.metrics.execution.failedTests}</p>
            <p>Pass Rate: ${report.kpis.primary.testPassRate.toFixed(1)}%</p>
        </div>

        <div class="metric-card">
            <h3>Test Coverage</h3>
            <p>Line Coverage: ${report.metrics.coverage.lineCoveragePercentage.toFixed(1)}%</p>
            <p>Branch Coverage: ${report.metrics.coverage.branchCoveragePercentage.toFixed(1)}%</p>
            <p>Function Coverage: ${report.metrics.coverage.functionCoveragePercentage.toFixed(1)}%</p>
        </div>

        <div class="metric-card">
            <h3>Security</h3>
            <p>Critical Vulnerabilities: ${report.metrics.security.criticalVulnerabilities}</p>
            <p>High Vulnerabilities: ${report.metrics.security.highVulnerabilities}</p>
            <p>Security Score: ${report.metrics.security.securityScore}/100</p>
        </div>

        <div class="metric-card">
            <h3>Performance</h3>
            <p>Average Response Time: ${report.metrics.performance.averageResponseTime}ms</p>
            <p>Error Rate: ${(report.metrics.performance.errorRate * 100).toFixed(2)}%</p>
            <p>Performance Score: ${report.kpis.primary.performanceScore}/100</p>
        </div>
    </div>

    <div class="recommendations">
        <h2>Recommendations</h2>
        <h3>Immediate Actions</h3>
        <ul>
            ${report.recommendations.immediate.map(rec => `<li>${rec}</li>`).join('')}
        </ul>

        <h3>Short-term Improvements</h3>
        <ul>
            ${report.recommendations.shortTerm.map(rec => `<li>${rec}</li>`).join('')}
        </ul>

        <h3>Long-term Strategy</h3>
        <ul>
            ${report.recommendations.longTerm.map(rec => `<li>${rec}</li>`).join('')}
        </ul>
    </div>
</body>
</html>
    `;
  }
}