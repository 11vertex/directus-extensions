<template>
	<section class="impact-report">
		<header>
			<h3 class="type-label">If you delete this {{ singularName }}</h3>
			<div class="header-actions">
				<router-link v-if="route" :to="route" class="link small">Open item</router-link>
				<v-button v-tooltip="'Close'" icon x-small secondary @click="emit('close')">
					<v-icon name="close" small />
				</v-button>
			</div>
		</header>

		<v-skeleton-loader v-if="loading" type="list-item-icon" />
		<p v-else-if="error" class="line danger"><v-icon name="error" small /> {{ error }}</p>

		<template v-else-if="report">
			<p class="headline" :class="headline.tone">
				<v-icon :name="headline.icon" />
				{{ headline.text }}
				<v-icon
					v-tooltip="'Read-only check based on your database rules. Nothing is deleted. Flows or hooks may do more.'"
					class="hint"
					name="info"
					small
				/>
			</p>

			<ul v-if="sentences.length" class="sentences">
				<li v-for="sentence in sentences" :key="sentence.key" class="line" :class="sentence.tone">
					<v-icon :name="ICONS[sentence.tone]" small />
					{{ sentence.text }}
				</li>
			</ul>

			<details @toggle="onRelatedToggle">
				<summary>Show related items</summary>
				<v-progress-circular v-if="related.loading" indeterminate small />
				<p v-else-if="related.error" class="line danger small">{{ related.error }}</p>
				<record-relations v-else-if="related.data" :data="related.data" @check="emit('check', $event)" />
			</details>

			<details>
				<summary>Technical details</summary>
				<ul class="technical small">
					<li v-for="entry in report.entries" :key="entry.id">
						<span class="mono">{{ entry.id }}</span> · {{ entry.type.toUpperCase() }} · {{ entry.count }} item(s) ·
						{{ entry.constraint ? `on delete ${entry.onDelete}` : 'no foreign key' }} — {{ entry.message }}
					</li>
					<li v-for="step in report.cascades" :key="step.collection">
						May in turn delete from <span class="mono">{{ step.collection }}</span> (via {{ step.via }})<template
							v-if="step.potentialBlockers.length"
						>; possible blockers: {{ step.potentialBlockers.join(', ') }}</template>
					</li>
				</ul>
			</details>
		</template>
	</section>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue';
import { useApi } from '@directus/extensions-sdk';
import { itemRoute } from '../../shared/links.js';
import { impactHeadline, impactSentences, singular } from '../../shared/wording.js';
import { useNames } from '../use-names.js';
import RecordRelations from './record-relations.vue';

const ICONS = { danger: 'block', warning: 'warning', info: 'link_off', success: 'check_circle' };

const props = defineProps({
	collection: { type: String, required: true },
	pk: { type: [String, Number], required: true },
});

const emit = defineEmits(['close', 'check']);

const api = useApi();
const { collectionName } = useNames();
const report = ref(null);
const loading = ref(false);
const error = ref(null);
const related = reactive({ data: null, loading: false, error: null });

const singularName = computed(() => singular(collectionName(props.collection).toLowerCase()));
const route = computed(() => itemRoute(props.collection, props.pk));
const headline = computed(() => impactHeadline(report.value.summary, report.value.record.label));
const sentences = computed(() => impactSentences(report.value?.entries ?? [], { collectionName }));

function message(err) {
	return err?.response?.data?.errors?.[0]?.message ?? err.message;
}

async function load() {
	loading.value = true;
	error.value = null;
	report.value = null;
	Object.assign(related, { data: null, loading: false, error: null });

	try {
		const { data } = await api.get(
			`/content-dependency-graph/impact/${encodeURIComponent(props.collection)}/${encodeURIComponent(props.pk)}`,
		);
		report.value = data;
	} catch (err) {
		error.value = message(err);
	} finally {
		loading.value = false;
	}
}

async function onRelatedToggle(event) {
	if (!event.target.open || related.data || related.loading) return;
	related.loading = true;
	related.error = null;

	try {
		const { data } = await api.get(
			`/content-dependency-graph/records/${encodeURIComponent(props.collection)}/${encodeURIComponent(props.pk)}`,
		);
		related.data = data;
	} catch (err) {
		related.error = message(err);
	} finally {
		related.loading = false;
	}
}

watch(() => [props.collection, props.pk], load, { immediate: true });
</script>

<style scoped>
.impact-report {
	display: flex;
	flex-direction: column;
	gap: 12px;
	padding: 20px;
	margin-bottom: 20px;
	background: var(--theme--background-subdued);
	border: var(--theme--border-width) solid var(--theme--border-color-subdued);
	border-radius: var(--theme--border-radius);
}

header {
	display: flex;
	justify-content: space-between;
	align-items: center;
	gap: 8px;
}

h3 { margin: 0; }
p { margin: 0; }

.header-actions {
	display: flex;
	align-items: center;
	gap: 12px;
}

.headline {
	display: flex;
	align-items: center;
	gap: 8px;
	font-size: 16px;
	font-weight: 600;
}

.headline .v-icon.hint { color: var(--theme--foreground-subdued); cursor: help; }

.sentences {
	display: flex;
	flex-direction: column;
	gap: 6px;
	margin: 0;
	padding: 0;
	list-style: none;
}

.line {
	display: flex;
	align-items: center;
	gap: 8px;
}

.danger .v-icon { color: var(--theme--danger); }
.warning .v-icon { color: var(--theme--warning); }
.info .v-icon { color: var(--theme--primary); }
.success .v-icon { color: var(--theme--success); }
p.danger { color: var(--theme--danger); }

summary {
	color: var(--theme--primary);
	cursor: pointer;
	margin-bottom: 8px;
}

.technical {
	margin: 0;
	padding-left: 18px;
	color: var(--theme--foreground-subdued);
}

.technical li { margin-bottom: 4px; }

.link { color: var(--theme--primary); }
.small { font-size: 13px; }
.mono { font-family: var(--theme--fonts--monospace--font-family), monospace; }
</style>
