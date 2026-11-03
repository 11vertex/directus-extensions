<template>
	<private-view title="Permission Auditor">
		<template #title-outer:prepend>
			<v-button class="header-icon" rounded disabled icon secondary>
				<v-icon name="policy" />
			</v-button>
		</template>

		<template #actions>
			<template v-if="isAdmin">
				<v-menu v-if="audit" show-arrow placement="bottom-end">
					<template #activator="{ toggle }">
						<v-button secondary small @click="toggle">
							<v-icon name="download" left small />
							Export
						</v-button>
					</template>
					<v-list>
						<v-list-item clickable @click="exportReport('json')">
							<v-list-item-content>Export as JSON</v-list-item-content>
						</v-list-item>
						<v-list-item clickable @click="exportReport('csv')">
							<v-list-item-content>Export as CSV</v-list-item-content>
						</v-list-item>
					</v-list>
				</v-menu>
				<v-button v-tooltip.bottom="'Re-run audit'" rounded icon secondary :loading="loading" @click="runAudit">
					<v-icon name="refresh" />
				</v-button>
			</template>
		</template>

		<div class="permission-auditor">
			<v-notice v-if="!isAdmin" type="danger">Only administrators can use Permission Auditor.</v-notice>

			<template v-else>
				<div v-if="loading && !audit" class="state">
					<v-progress-circular indeterminate />
					<span>Checking every policy…</span>
				</div>

				<v-notice v-else-if="error && !audit" type="danger">
					Couldn't run the audit: {{ error }}. Try “Re-run” in the top right.
				</v-notice>

				<template v-else-if="audit">
					<header class="verdict" :class="verdict.tone">
						<v-icon :name="verdict.icon" />
						<div>
							<strong>{{ verdict.text }}</strong>
							<p class="muted">
								Checked {{ audit.summary.policies }}
								{{ audit.summary.policies === 1 ? 'policy' : 'policies' }}
								<template v-if="checkedAgo"> · {{ checkedAgo }}</template>
							</p>
						</div>
					</header>

					<v-notice v-if="error" type="warning" class="spaced">Re-run failed: {{ error }}</v-notice>

					<template v-for="group in groups" :key="group.id">
						<details v-if="group.findings.length" class="group" :class="group.id" :open="group.open">
							<summary>
								<v-icon :name="group.icon" small />
								{{ group.title }}
								<span class="count">{{ group.findings.length }}</span>
							</summary>

							<article v-for="finding in group.findings" :key="finding.id" class="finding">
								<h3>{{ finding.title }}</h3>
								<p>{{ finding.detail }}</p>
								<p v-if="finding.hint" class="fix"><strong>How to fix:</strong> {{ finding.hint }}</p>
								<footer>
									<v-button secondary x-small :to="policyLink(finding)">
										<v-icon name="open_in_new" left x-small />
										Open policy{{ finding.policyName ? ` “${finding.policyName}”` : '' }}
									</v-button>
									<details class="tech">
										<summary>Technical details</summary>
										<p class="mono">
											{{ finding.rule }} · {{ finding.severity }}<template v-if="finding.collection">
												· {{ finding.collection }}</template
											><template v-if="finding.action"> · {{ finding.action }}</template>
										</p>
									</details>
								</footer>
							</article>
						</details>
					</template>
				</template>
			</template>
		</div>
	</private-view>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useApi, useStores } from '@directus/extensions-sdk';
import { formatAuditCsv, formatAuditJson } from '../shared/reports.js';

const GROUPS = [
	{ id: 'fix', title: 'Fix now', icon: 'error', severities: ['critical', 'high'], open: true },
	{ id: 'review', title: 'Worth reviewing', icon: 'warning', severities: ['medium'], open: true },
	{ id: 'info', title: 'Good to know', icon: 'info', severities: ['low', 'info'], open: false },
];

const api = useApi();
const { useUserStore } = useStores();
const userStore = useUserStore();
const isAdmin = computed(() => userStore.currentUser?.admin_access === true);

const audit = ref(null);
const loading = ref(false);
const error = ref(null);
const now = ref(Date.now());
let timer = null;

const groups = computed(() =>
	GROUPS.map((group) => ({
		...group,
		findings: (audit.value?.findings ?? []).filter((finding) => group.severities.includes(finding.severity)),
	})),
);

const verdict = computed(() => {
	const [fix, review] = groups.value.map((group) => group.findings.length);
	if (fix > 0) {
		const rest = review > 0 ? `, ${review} to review` : '';
		return { tone: 'danger', icon: 'error', text: `${fix} ${fix === 1 ? 'problem' : 'problems'} to fix${rest}` };
	}
	if (review > 0) return { tone: 'warning', icon: 'warning', text: `Nothing urgent · ${review} to review` };
	return { tone: 'success', icon: 'check_circle', text: 'No problems found' };
});

const checkedAgo = computed(() => {
	const at = Date.parse(audit.value?.generatedAt ?? '');
	if (Number.isNaN(at)) return null;
	const minutes = Math.floor((now.value - at) / 60000);
	if (minutes < 1) return 'just now';
	if (minutes < 60) return `${minutes} min ago`;
	const hours = Math.floor(minutes / 60);
	return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
});

onMounted(() => {
	if (isAdmin.value) runAudit();
	timer = setInterval(() => (now.value = Date.now()), 30000);
});

onUnmounted(() => clearInterval(timer));

async function runAudit() {
	loading.value = true;
	error.value = null;

	try {
		const { data } = await api.get('/permission-auditor/audit');
		audit.value = data;
		now.value = Date.now();
	} catch (err) {
		error.value = err?.response?.data?.errors?.[0]?.message ?? err.message;
	} finally {
		loading.value = false;
	}
}

function policyLink(finding) {
	return finding.policyId ? `/settings/policies/${encodeURIComponent(finding.policyId)}` : '/settings/policies';
}

function exportReport(format) {
	const content = format === 'json' ? formatAuditJson(audit.value) : formatAuditCsv(audit.value);
	const blob = new Blob([content], { type: `${format === 'json' ? 'application/json' : 'text/csv'};charset=utf-8` });
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement('a');
	anchor.href = url;
	anchor.download = `permission-audit-${new Date().toISOString().replaceAll(':', '-')}.${format}`;
	anchor.click();
	URL.revokeObjectURL(url);
}
</script>

<style scoped>
.permission-auditor {
	padding: var(--content-padding);
	padding-bottom: var(--content-padding-bottom);
	max-width: 900px;
}

.header-icon {
	margin-right: 8px;
}

.state {
	display: flex;
	align-items: center;
	gap: 12px;
	color: var(--theme--foreground-subdued);
}

.verdict {
	display: flex;
	align-items: center;
	gap: 14px;
	padding: 16px 20px;
	margin-bottom: 24px;
	border-radius: var(--theme--border-radius);
	border: var(--theme--border-width) solid currentColor;
	font-size: 18px;
}

.verdict p {
	margin: 2px 0 0;
	font-size: 14px;
}

.verdict.danger { color: var(--theme--danger); }
.verdict.warning { color: var(--theme--warning); }
.verdict.success { color: var(--theme--success); }
.verdict strong { color: var(--theme--foreground); }

.spaced {
	margin-bottom: 20px;
}

.group {
	margin-bottom: 24px;
}

.group > summary {
	display: flex;
	align-items: center;
	gap: 8px;
	margin-bottom: 12px;
	font-size: 16px;
	font-weight: 600;
	cursor: pointer;
}

.group.fix > summary .v-icon { color: var(--theme--danger); }
.group.review > summary .v-icon { color: var(--theme--warning); }
.group.info > summary .v-icon { color: var(--theme--foreground-subdued); }

.count {
	padding: 0 8px;
	border-radius: 999px;
	font-size: 12px;
	background: var(--theme--background-normal);
	color: var(--theme--foreground-subdued);
}

.finding {
	background: var(--theme--background-subdued);
	border: var(--theme--border-width) solid var(--theme--border-color-subdued);
	border-left: 3px solid var(--theme--foreground-subdued);
	border-radius: var(--theme--border-radius);
	padding: 14px 18px;
	margin-bottom: 10px;
}

.group.fix .finding { border-left-color: var(--theme--danger); }
.group.review .finding { border-left-color: var(--theme--warning); }

.finding h3 {
	margin: 0;
	font-size: 15px;
	font-weight: 600;
}

.finding p {
	margin: 6px 0 0;
}

.fix {
	font-size: 14px;
}

.finding footer {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 16px;
	margin-top: 12px;
}

.tech summary {
	font-size: 12px;
	color: var(--theme--foreground-subdued);
	cursor: pointer;
}

.tech p {
	margin-top: 4px;
	font-size: 12px;
	color: var(--theme--foreground-subdued);
}

.muted {
	color: var(--theme--foreground-subdued);
}

.mono {
	font-family: var(--theme--fonts--monospace--font-family), monospace;
}
</style>
