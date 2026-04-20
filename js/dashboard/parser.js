/**
 * EMA Studio - Data Parser Engine
 * Handles ingesting a local folder of JSON files, separating the config
 * from the participant payloads, and calculating metadata KPIs.
 */

const DataParser = {
    state: {
      studyConfig: null,
      allSessions: [],       // Source of truth for all imported data
      filteredSessions: [],  // The data currently being viewed/analyzed
      participants: new Set(),
      metrics: {
        totalExpectedPings: 0,
        totalDelivered: 0,
        totalCompleted: 0,
        totalMissed: 0,
        totalNoise: 0, 
        avgTimeMs: 0,
        avgLatencyMs: 0,
        complianceByDay: {}, 
        latencyByDay: {}
      }
    },
  
    async ingestFiles(fileList) {
      this.resetState();
      
      const files = Array.from(fileList).filter(f => f.name.endsWith('.json'));
      if (files.length === 0) throw new Error("No JSON files found in directory.");
  
      const readPromises = files.map(file => {
        return new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = (e) => {
            try {
              const json = JSON.parse(e.target.result);
              if (json.schedule && json.study) {
                this.state.studyConfig = json;
              } else if (json.metadata || json.participantId) {
                this.state.allSessions.push(this.normalizeSession(json));
              }
            } catch (err) {
              console.warn(`Could not parse ${file.name}`);
            }
            resolve();
          };
          reader.readAsText(file);
        });
      });
  
      await Promise.all(readPromises);
      
      // Calculate initial metrics
      this.state.allSessions.forEach(s => this.state.participants.add(s.participantId));
      this.calculateMetrics({ excludeNoise: true, excludeMissed: false, day: 'all', participant: 'all' });
      return this.state;
    },
  
    resetState() {
      this.state.studyConfig = null;
      this.state.allSessions = [];
      this.state.filteredSessions = [];
      this.state.participants.clear();
      this.state.metrics = {
        totalExpectedPings: 0, totalDelivered: 0, totalCompleted: 0,
        totalMissed: 0, totalNoise: 0, avgTimeMs: 0, avgLatencyMs: 0,
        complianceByDay: {}, latencyByDay: {}
      };
    },
  
    normalizeSession(json) {
      const meta = json.metadata || json; 
      const payload = json.payload || {}; 
      
      const start = new Date(meta.startedAt || meta.startTime || Date.now()).getTime();
      const end = new Date(meta.completedAt || meta.endTime || Date.now()).getTime();
      const delivered = new Date(meta.promptDeliveredAt || meta.scheduledTime || start).getTime();
  
      const durationMs = end - start;
      const latencyMs = start - delivered;
  
      return {
        participantId: meta.participantId || meta.id || 'Unknown',
        day: parseInt(meta.dayNumber || meta.day || 1, 10),
        sessionType: meta.sessionType || meta.session || 'unknown',
        durationMs: durationMs > 0 ? durationMs : 0,
        latencyMs: latencyMs > 0 ? latencyMs : 0,
        isCompleted: true, 
        isNoise: durationMs < 30000, // Speeding detection
        ...payload 
      };
    },
  
    /**
     * Recalculates all math based on ALL active UI filters
     */
    calculateMetrics(filters = { excludeNoise: false, excludeMissed: false, day: 'all', participant: 'all' }) {
      let sessions = this.state.allSessions;
      
      // 1. Apply Scope Filters (Date & Participant)
      if (filters.day !== 'all') {
        sessions = sessions.filter(s => s.day === parseInt(filters.day, 10));
      }
      if (filters.participant !== 'all') {
        sessions = sessions.filter(s => s.participantId === filters.participant);
      }

      // Calculate Total Noise strictly based on Date/Participant scope 
      // (We calculate this BEFORE excluding noise so the UI can still show how much noise there *was*)
      this.state.metrics.totalNoise = sessions.filter(s => s.isNoise).length;

      // 2. Apply Quality Filters
      if (filters.excludeNoise) {
        sessions = sessions.filter(s => !s.isNoise);
      }
      this.state.filteredSessions = sessions;
  
      // 3. Base Expected Math
      let pCount = filters.participant !== 'all' ? 1 : (this.state.participants.size || 1);
      let expectedPerDay = this.state.studyConfig?.schedule?.windows?.length || 3; 
      let studyDays = this.state.studyConfig?.study?.days || Math.max(...this.state.allSessions.map(s => s.day), 1);
      
      if (filters.day !== 'all') {
        this.state.metrics.totalExpectedPings = pCount * expectedPerDay;
      } else {
        this.state.metrics.totalExpectedPings = pCount * studyDays * expectedPerDay;
      }

      this.state.metrics.totalCompleted = sessions.length;
      
      // Handle the "Exclude Missed" toggle logic
      if (filters.excludeMissed) {
          this.state.metrics.totalExpectedPings = this.state.metrics.totalCompleted;
          this.state.metrics.totalMissed = 0;
      } else {
          this.state.metrics.totalMissed = Math.max(0, this.state.metrics.totalExpectedPings - this.state.metrics.totalCompleted);
      }

      this.state.metrics.totalDelivered = this.state.metrics.totalExpectedPings; 
  
      let totalDuration = 0;
      let totalLatency = 0;
      this.state.metrics.complianceByDay = {};
      this.state.metrics.latencyByDay = {};
  
      // Setup day buckets based on filter
      const daysToTrack = filters.day !== 'all' ? [parseInt(filters.day, 10)] : Array.from({length: studyDays}, (_, i) => i + 1);
      daysToTrack.forEach(d => {
        this.state.metrics.complianceByDay[d] = { 
            completed: 0, 
            missed: filters.excludeMissed ? 0 : pCount * expectedPerDay, 
            latencies: [] 
        };
      });
  
      // 4. Crunch the final filtered sessions
      sessions.forEach(s => {
        totalDuration += s.durationMs;
        totalLatency += s.latencyMs;
  
        if (this.state.metrics.complianceByDay[s.day]) {
           this.state.metrics.complianceByDay[s.day].completed++;
           
           if (!filters.excludeMissed) {
             this.state.metrics.complianceByDay[s.day].missed = Math.max(0, this.state.metrics.complianceByDay[s.day].missed - 1);
           }
           this.state.metrics.complianceByDay[s.day].latencies.push(s.latencyMs);
        }
      });
  
      if (sessions.length > 0) {
        this.state.metrics.avgTimeMs = totalDuration / sessions.length;
        this.state.metrics.avgLatencyMs = totalLatency / sessions.length;
      } else {
        this.state.metrics.avgTimeMs = 0;
        this.state.metrics.avgLatencyMs = 0;
      }
  
      // Calculate Average Latency per day
      Object.keys(this.state.metrics.complianceByDay).forEach(day => {
        const lats = this.state.metrics.complianceByDay[day].latencies;
        this.state.metrics.latencyByDay[day] = lats.length > 0 ? (lats.reduce((a,b)=>a+b,0) / lats.length) : 0;
      });
    }
  };
