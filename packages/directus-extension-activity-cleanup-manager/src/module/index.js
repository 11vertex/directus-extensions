import { defineModule } from "@directus/extensions-sdk";
import ModuleComponent from "./module.vue";

export default defineModule({
  id: "activity-cleanup-manager",
  name: "Activity Cleanup",
  icon: "cleaning_services",
  routes: [{ path: "", component: ModuleComponent }],
  preRegisterCheck(user) {
    return user?.admin_access === true;
  }
});
