"""Persistent host-side read-only sampler; credentials and query text stay on VM."""
import base64
import hashlib
import http.client
import json
import os
import re
import subprocess
import sys
import time

QUERY = """SHOW TRANSACTIONS YIELD currentQuery, currentQueryElapsedTime,
currentQueryCpuTime, currentQueryWaitTime, currentQueryAllocatedBytes, pageHits,
pageFaults WHERE NOT currentQuery STARTS WITH 'SHOW TRANSACTIONS'
RETURN currentQuery, toString(currentQueryElapsedTime), toString(currentQueryCpuTime),
toString(currentQueryWaitTime), currentQueryAllocatedBytes, pageHits, pageFaults LIMIT 50"""


def main():
    cgroup = open('/proc/self/cgroup').read().strip()
    if 'hey-hey-staging.slice' in cgroup:
        raise RuntimeError('Collector must run outside staging slice')
    # Setup only, before baseline. No query client starts in the container.
    password = subprocess.check_output(['docker', 'exec', 'hey-hey-staging-neo4j-1',
                                       'cat', '/run/secrets/neo4j_password']).strip()
    headers = {'Authorization': 'Basic ' + base64.b64encode(b'neo4j:' + password).decode(),
               'Content-Type': 'application/json'}
    connection = http.client.HTTPConnection('127.0.0.1', int(sys.argv[1]), timeout=3)
    def execute(statement):
        connection.request('POST', '/db/neo4j/tx/commit',
                           json.dumps({'statements': [{'statement': statement}]}), headers)
        response = connection.getresponse()
        data = json.loads(response.read())
        if response.status != 200 or data['errors']:
            raise RuntimeError('Read failed')
        return data['results'][0]['data']

    jmx_supported = False
    try:
        jmx_supported = bool(execute("SHOW PROCEDURES YIELD name WHERE name = 'dbms.queryJmx' RETURN name"))
    except Exception:
        connection.close()
    print(json.dumps({'ready': True, 'collectorCgroup': cgroup}), flush=True)
    for line in sys.stdin:
        if line.strip() != 'sample':
            break
        started = time.time_ns()
        try:
            rows = []
            for entry in execute(QUERY):
                text, elapsed, cpu, wait, allocated, hits, faults = entry['row']
                template = re.sub(r"'(?:\\.|''|[^'\\])*'|\"(?:\\.|\"\"|[^\"\\])*\"|/\*[\s\S]*?\*/|//[^\n]*", '?', text)
                template = re.sub(r'\b\d+(?:\.\d+)?\b', '?', template)
                template = re.sub(r'\s+', ' ', template).strip()
                rows.append(dict(fingerprint=hashlib.sha256(template.encode()).hexdigest(),
                                 elapsed=elapsed, cpu=cpu, wait=wait, allocatedBytes=allocated,
                                 pageHits=hits, pageFaults=faults))
            result = {'queries': rows, 'possiblyTruncated': len(rows) == 50}
        except Exception:
            connection.close()
            result = {'queryError': 'Persistent Neo4j query read failed; details suppressed'}
        result['jvm'] = {'supported': jmx_supported, 'counters': [], 'gaps': []}
        if jmx_supported:
            for kind, pattern, allowed in [
                ('gc', 'java.lang:type=GarbageCollector,name=*', ['CollectionCount', 'CollectionTime']),
                ('compilation', 'java.lang:type=Compilation', ['TotalCompilationTime']),
            ]:
                try:
                    entries = execute("CALL dbms.queryJmx('" + pattern + "') YIELD name, attributes RETURN name, attributes")
                    for entry in entries:
                        name, attributes = entry['row']
                        values = {key: attributes[key]['value'] for key in allowed
                                  if key in attributes and isinstance(attributes[key].get('value'), (int, float))}
                        result['jvm']['counters'].append({'kind': kind, 'name': name, 'values': values})
                except Exception:
                    connection.close()
                    result['jvm']['gaps'].append(kind + ' counters unavailable')
        else:
            result['jvm']['gaps'].append('dbms.queryJmx unavailable')
        result['jvm']['gaps'].append('No configured query-cache/replanning or safepoint source; JVM compilation is not Cypher replanning')
        result.update(startedAtNs=str(started), endedAtNs=str(time.time_ns()),
                      collectorCpuSeconds=time.process_time(), collectorPid=os.getpid(),
                      collectorCgroup=cgroup)
        print(json.dumps(result), flush=True)
    connection.close()


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print(json.dumps({'queryError': 'Neo4j sampler initialization failed'}), flush=True)
        sys.exit(1)
