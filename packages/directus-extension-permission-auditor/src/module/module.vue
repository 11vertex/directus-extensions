<template>
	<private-view title="Permission Auditor">
		<template #title-outer:prepend>
			<v-button class="header-icon" rounded disabled icon secondary>
				<v-icon name="policy" />
			</v-button>
		</template>

		<template #actions>
			<template v-if="isAdmin">
				<v-button v-tooltip.bottom="'Re-run audit'" rounded icon secondary :loading="loading" @click="runAudit">
					<v-icon name="refresh" />
				</v-button>
				<v-menu v-if="audit" show-arrow placement="bottom-end">
					<template #activator="{ toggle }">
						<v-button v-tooltip.bottom="'Export'" rounded icon secondary @click="toggle">
							<v-icon name="download" />
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
			</template>
		</template>

		<template v-if="isAdmin" #navigation>
			<div class="nav-activity">
				<label class="field-label">Show</label>
				<button type="button" class="nav-row" :class="{ active: filter === 'all' }" @click="filter = 'all'">
					<v-icon name="list" small />
					<span class="nav-text">All findings</span>
					<span class="pill">{{ totalFindings }}</span>
				</button>
				<button
					v-for="group in groups"
					:key="group.id"
					type="button"
					class="nav-row"
					:class="[group.id, { active: filter === group.id }]"
					:disabled="!group.findings.length"
					@click="filter = group.id"
				>
					<v-icon :name="group.icon" small />
					<span class="nav-text">{{ group.title }}</span>
					<span class="pill" :class="group.id">{{ group.findings.length }}</span>
				</button>
				<p v-if="audit" class="hint">
					Checked {{ audit.summary.policies }} {{ audit.summary.policies === 1 ? 'policy' : 'policies' }}<template v-if="checkedAgo"> · {{ checkedAgo }}</template>
				</p>
			</div>
		</template>

		<div class="permission-auditor">
			<v-notice v-if="!isAdmin" type="danger" class="padded">Only administrators can use Permission Auditor.</v-notice>

			<template v-else>
				<div v-if="loading && !audit" class="state padded">
					<v-progress-circular indeterminate />
					<span>Checking every policy…</span>
				</div>

				<v-notice v-else-if="error && !audit" type="danger" class="padded">
					Couldn't run the audit: {{ error }}. Use the refresh button to try again.
				</v-notice>

				<template v-else-if="audit">
					<header class="run-bar">
						<div class="run-title">
							<v-icon :name="verdict.icon" :class="verdict.tone" />
							<strong>{{ verdict.text }}</strong>
							<span v-for="group in groups" :key="group.id">
								<span v-if="group.findings.length" class="pill" :class="group.id">{{ group.findings.length }} {{ group.title.toLowerCase() }}</span>
							</span>
						</div>
					</header>

					<v-notice v-if="error" type="warning" class="padded">Re-run failed: {{ error }}</v-notice>

					<v-info v-if="!totalFindings" class="empty" icon="verified_user" title="No problems found" center>
						Every policy looks fine. Run the audit again after changing permissions.
					</v-info>

					<div v-else class="findings">
						<section v-for="group in shownGroups" :key="group.id" class="group" :class="group.id">
							<h4 class="group-title">{{ group.title }}</h4>
							<article v-for="finding in group.findings" :key="finding.id" class="finding">
								<div class="finding-main">
									<h3>{{ finding.title }}</h3>
									<p>{{ finding.detail }}</p>
									<p v-if="finding.hint" class="fix"><strong>How to fix:</strong> {{ finding.hint }}</p>
									<details class="tech">
										<summary>Technical details</summary>
										<p class="mono">
											{{ finding.rule }} · {{ finding.severity }}<template v-if="finding.collection">
												· {{ finding.collection }}</template
											><template v-if="finding.action"> · {{ finding.action }}</template>
										</p>
									</details>
								</div>
								<v-button v-tooltip.bottom="`Open policy${finding.policyName ? ` “${finding.policyName}”` : ''}`" secondary small icon :to="policyLink(finding)">
									<v-icon name="open_in_new" small />
								</v-button>
							</article>
						</section>
					</div>
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

const filter = ref('all');
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

const shownGroups = computed(() =>
	groups.value.filter((group) => group.findings.length && (filter.value === 'all' || filter.value === group.id)),
);
const totalFindings = computed(() => groups.value.reduce((total, group) => total + group.findings.length, 0));

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
	display: flex;
	flex-direction: column;
	height: calc(100vh - 64px);
	min-height: 420px;
}

.padded {
	margin: var(--content-padding);
}

.empty {
	flex: 1;
}

.header-icon {
	margin-right: 8px;
}

.nav-activity {
	display: flex;
	flex-direction: column;
	gap: 8px;
	padding: 12px 12px 20px;
}

.field-label {
	color: var(--theme--foreground-subdued);
	font-size: 12px;
	font-weight: 600;
	letter-spacing: 0.04em;
	text-transform: uppercase;
}

.hint {
	margin: 8px 2px 0;
	color: var(--theme--foreground-subdued);
	font-size: 12px;
}

.nav-row {
	display: flex;
	align-items: center;
	gap: 10px;
	width: 100%;
	box-sizing: border-box;
	padding: 8px 10px;
	border: none;
	border-left: 3px solid transparent;
	border-radius: var(--theme--border-radius);
	background: transparent;
	color: inherit;
	font: inherit;
	text-align: left;
	cursor: pointer;
}

.nav-row:hover:not(:disabled) {
	background: var(--theme--background-subdued);
}

.nav-row.active {
	border-left-color: var(--theme--primary);
	background: color-mix(in srgb, var(--theme--primary) 12%, transparent);
}

.nav-row:disabled {
	opacity: 0.45;
	cursor: default;
}

.nav-text {
	flex: 1;
}

.nav-row.fix .v-icon,
.run-title .v-icon.danger {
	color: var(--theme--danger);
}

.nav-row.review .v-icon,
.run-title .v-icon.warning {
	color: var(--theme--warning);
}

.run-title .v-icon.success {
	color: var(--theme--success);
}

.run-bar {
	display: flex;
	align-items: center;
	min-height: 64px;
	padding: 12px var(--content-padding);
	border-bottom: var(--theme--border-width) solid var(--theme--border-color-subdued);
}

.run-title {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 10px;
}

.pill {
	flex: none;
	padding: 0 8px;
	border-radius: 999px;
	font-size: 11px;
	font-weight: 600;
	line-height: 18px;
	background: color-mix(in srgb, var(--pill, var(--theme--foreground-subdued)) 16%, transparent);
	color: var(--pill, var(--theme--foreground-subdued));
}

.pill.fix {
	--pill: var(--theme--danger);
}

.pill.review {
	--pill: var(--theme--warning);
}

.state {
	display: flex;
	align-items: center;
	gap: 12px;
	color: var(--theme--foreground-subdued);
}

.findings {
	flex: 1;
	min-height: 0;
	overflow: auto;
}

.group-title {
	margin: 0;
	padding: 8px var(--content-padding);
	background: var(--theme--background-subdued);
	color: var(--theme--foreground-subdued);
	font-size: 11px;
	font-weight: 600;
	letter-spacing: 0.05em;
	text-transform: uppercase;
}

.finding {
	display: flex;
	align-items: flex-start;
	justify-content: space-between;
	gap: 16px;
	padding: 16px var(--content-padding);
	border-bottom: var(--theme--border-width) solid var(--theme--border-color-subdued);
	border-left: 3px solid var(--theme--foreground-subdued);
}

.group.fix .finding {
	border-left-color: var(--theme--danger);
}

.group.review .finding {
	border-left-color: var(--theme--warning);
}

.finding-main {
	min-width: 0;
}

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

.tech {
	margin-top: 8px;
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

.mono {
	font-family: var(--theme--fonts--monospace--font-family), monospace;
}
</style>
