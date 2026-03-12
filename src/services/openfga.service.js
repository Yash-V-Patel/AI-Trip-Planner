const { OpenFgaClient } = require("@openfga/sdk");

const ROLE_TO_RELATION = {
  ADMIN:   'is_admin',
  MANAGER: 'is_manager',
  EDITOR:  'is_editor',
  VIEWER:  'is_viewer',
};

class OpenFGAService {
  constructor() {
    this.client = null;
    this.storeId = null;
    this.modelId = null;
    this.initialized = false;
    this.initializing = false;
  }

  async isAvailable() {
    try {
      if (!this.initialized) return false;
      await this.client.readAuthorizationModels();
      return true;
    } catch (error) {
      console.error("OpenFGA availability check failed:", error.message);
      return false;
    }
  }

  async initialize() {
    if (this.initialized) return true;
    if (this.initializing) {
      while (this.initializing) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return this.initialized;
    }

    this.initializing = true;

    try {
      const apiUrl = process.env.OPENFGA_API_URL || "http://localhost:8080";
      const fgaClient = new OpenFgaClient({ apiUrl });

      console.log("Checking for existing OpenFGA stores...");
      const stores = await fgaClient.listStores();
      let store = stores.stores.find((s) => s.name === "AI-trip-planner");

      if (!store) {
        console.log("Creating new OpenFGA store...");
        store = await fgaClient.createStore({ name: "AI-trip-planner" });
      } else {
        console.log("Found existing OpenFGA store");
      }

      this.storeId = store.id;
      console.log(`✓ OpenFGA Store ID: ${this.storeId}`);

      this.client = new OpenFgaClient({ apiUrl, storeId: this.storeId });

      console.log("Checking for existing authorization models...");
      const models = await this.client.readAuthorizationModels();

      if (models.authorization_models.length > 0) {
        this.modelId = models.authorization_models[0].id;
        console.log(`✓ Using existing authorization model: ${this.modelId}`);
      } else {
        console.log("Creating new authorization model...");

        const model = await this.client.writeAuthorizationModel({
          schema_version: "1.1",
          type_definitions: [
            // ─── user ───────────────────────────────────────────────
            { type: "user", relations: {}, metadata: null },

            // ─── superadmin ─────────────────────────────────────────
            {
              type: "superadmin",
              relations: {
                member: { this: {} },
                can_manage_all: { computedUserset: { object: "", relation: "member" } },
                can_approve_vendors: { computedUserset: { object: "", relation: "member" } },
                can_manage_payouts: { computedUserset: { object: "", relation: "member" } },
                can_manage_users: { computedUserset: { object: "", relation: "member" } },
              },
              metadata: {
                relations: {
                  member: { directly_related_user_types: [{ type: "user" }] },
                  can_manage_all: { directly_related_user_types: [] },
                  can_approve_vendors: { directly_related_user_types: [] },
                  can_manage_payouts: { directly_related_user_types: [] },
                  can_manage_users: { directly_related_user_types: [] },
                },
              },
            },

            // ─── vendor_application ─────────────────────────────────
            {
              type: "vendor_application",
              relations: {
                applicant: { this: {} },
                reviewer: { this: {} },
                can_view: {
                  union: {
                    child: [
                      { computedUserset: { object: "", relation: "applicant" } },
                      { computedUserset: { object: "", relation: "reviewer" } },
                    ],
                  },
                },
                can_approve: { computedUserset: { object: "", relation: "reviewer" } },
                can_reject: { computedUserset: { object: "", relation: "reviewer" } },
                can_withdraw: { computedUserset: { object: "", relation: "applicant" } },
              },
              metadata: {
                relations: {
                  applicant: { directly_related_user_types: [{ type: "user" }] },
                  reviewer: { directly_related_user_types: [{ type: "user" }] },
                  can_view: { directly_related_user_types: [] },
                  can_approve: { directly_related_user_types: [] },
                  can_reject: { directly_related_user_types: [] },
                  can_withdraw: { directly_related_user_types: [] },
                },
              },
            },

            // ─── vendor ─────────────────────────────────────────────
            {
              type: "vendor",
              relations: {
                owner: { this: {} },
                admin: { this: {} },
                superadmin_access: { this: {} },
                is_staff: {
                  union: {
                    child: [
                      { computedUserset: { object: "", relation: "owner" } },
                      { computedUserset: { object: "", relation: "admin" } },
                    ],
                  },
                },
                can_manage_team: {
                  union: {
                    child: [
                      { computedUserset: { object: "", relation: "owner" } },
                      { computedUserset: { object: "", relation: "admin" } },
                      { computedUserset: { object: "", relation: "superadmin_access" } },
                    ],
                  },
                },
                can_view_financials: {
                  union: {
                    child: [
                      { computedUserset: { object: "", relation: "owner" } },
                      { computedUserset: { object: "", relation: "admin" } },
                      { computedUserset: { object: "", relation: "superadmin_access" } },
                    ],
                  },
                },
                can_request_payout: {
                  union: {
                    child: [
                      { computedUserset: { object: "", relation: "owner" } },
                      { computedUserset: { object: "", relation: "admin" } },
                      { computedUserset: { object: "", relation: "superadmin_access" } },
                    ],
                  },
                },
                can_view_dashboard: {
                  union: {
                    child: [
                      { computedUserset: { object: "", relation: "owner" } },
                      { computedUserset: { object: "", relation: "admin" } },
                      { computedUserset: { object: "", relation: "superadmin_access" } },
                    ],
                  },
                },
                can_sell_accommodations: { this: {} },
                can_sell_transportation: { this: {} },
                can_sell_experiences: { this: {} },
                can_sell_packages: { this: {} },
                can_sell_shopping: { this: {} },
              },
              metadata: {
                relations: {
                  owner: { directly_related_user_types: [{ type: "user" }] },
                  admin: { directly_related_user_types: [{ type: "user" }] },
                  superadmin_access: { directly_related_user_types: [{ type: "user" }] },
                  is_staff: { directly_related_user_types: [] },
                  can_manage_team: { directly_related_user_types: [] },
                  can_view_financials: { directly_related_user_types: [] },
                  can_request_payout: { directly_related_user_types: [] },
                  can_view_dashboard: { directly_related_user_types: [] },
                  can_sell_accommodations: { directly_related_user_types: [{ type: "user" }] },
                  can_sell_transportation: { directly_related_user_types: [{ type: "user" }] },
                  can_sell_experiences: { directly_related_user_types: [{ type: "user" }] },
                  can_sell_packages: { directly_related_user_types: [{ type: "user" }] },
                  can_sell_shopping: { directly_related_user_types: [{ type: "user" }] },
                },
              },
            },

            // ─── vendor_team_member ──────────────────────────────────
            {
              type: "vendor_team_member",
              relations: {
                vendor: { this: {} },
                user: { this: {} },
                is_owner: { this: {} },
                is_admin: { this: {} },
                is_manager: { this: {} },
                is_editor: { this: {} },
                is_viewer: { this: {} },
                can_manage_team: {
                  union: {
                    child: [
                      { computedUserset: { object: "", relation: "is_owner" } },
                      { computedUserset: { object: "", relation: "is_admin" } },
                    ],
                  },
                },
                can_manage_listings: {
                  union: {
                    child: [
                      { computedUserset: { object: "", relation: "is_owner" } },
                      { computedUserset: { object: "", relation: "is_admin" } },
                      { computedUserset: { object: "", relation: "is_manager" } },
                    ],
                  },
                },
                can_edit_listings: {
                  union: {
                    child: [
                      { computedUserset: { object: "", relation: "is_owner" } },
                      { computedUserset: { object: "", relation: "is_admin" } },
                      { computedUserset: { object: "", relation: "is_manager" } },
                      { computedUserset: { object: "", relation: "is_editor" } },
                    ],
                  },
                },
                can_view_listings: {
                  union: {
                    child: [
                      { computedUserset: { object: "", relation: "is_owner" } },
                      { computedUserset: { object: "", relation: "is_admin" } },
                      { computedUserset: { object: "", relation: "is_manager" } },
                      { computedUserset: { object: "", relation: "is_editor" } },
                      { computedUserset: { object: "", relation: "is_viewer" } },
                    ],
                  },
                },
                can_view_analytics: {
                  union: {
                    child: [
                      { computedUserset: { object: "", relation: "is_owner" } },
                      { computedUserset: { object: "", relation: "is_admin" } },
                      { computedUserset: { object: "", relation: "is_manager" } },
                    ],
                  },
                },
                can_view_financials: {
                  union: {
                    child: [
                      { computedUserset: { object: "", relation: "is_owner" } },
                      { computedUserset: { object: "", relation: "is_admin" } },
                    ],
                  },
                },
              },
              metadata: {
                relations: {
                  vendor: { directly_related_user_types: [{ type: "vendor" }] },
                  user: { directly_related_user_types: [{ type: "user" }] },
                  is_owner: { directly_related_user_types: [{ type: "user" }] },
                  is_admin: { directly_related_user_types: [{ type: "user" }] },
                  is_manager: { directly_related_user_types: [{ type: "user" }] },
                  is_editor: { directly_related_user_types: [{ type: "user" }] },
                  is_viewer: { directly_related_user_types: [{ type: "user" }] },
                  can_manage_team: { directly_related_user_types: [] },
                  can_manage_listings: { directly_related_user_types: [] },
                  can_edit_listings: { directly_related_user_types: [] },
                  can_view_listings: { directly_related_user_types: [] },
                  can_view_analytics: { directly_related_user_types: [] },
                  can_view_financials: { directly_related_user_types: [] },
                },
              },
            },

            // ─── vendor_profile ──────────────────────────────────────
            {
              type: "vendor_profile",
              relations: {
                owner: { this: {} },
                admin: { this: {} },
                team_member: { this: {} },
                superadmin_access: { this: {} },
                can_view: {
                  union: {
                    child: [
                      { computedUserset: { object: "", relation: "owner" } },
                      { computedUserset: { object: "", relation: "admin" } },
                      { computedUserset: { object: "", relation: "team_member" } },
                      { computedUserset: { object: "", relation: "superadmin_access" } },
                    ],
                  },
                },
                can_edit: {
                  union: {
                    child: [
                      { computedUserset: { object: "", relation: "owner" } },
                      { computedUserset: { object: "", relation: "admin" } },
                      { computedUserset: { object: "", relation: "superadmin_access" } },
                    ],
                  },
                },
                can_manage_documents: {
                  union: {
                    child: [
                      { computedUserset: { object: "", relation: "owner" } },
                      { computedUserset: { object: "", relation: "admin" } },
                      { computedUserset: { object: "", relation: "superadmin_access" } },
                    ],
                  },
                },
                can_manage_team_members: {
                  union: {
                    child: [
                      { computedUserset: { object: "", relation: "owner" } },
                      { computedUserset: { object: "", relation: "admin" } },
                      { computedUserset: { object: "", relation: "superadmin_access" } },
                    ],
                  },
                },
                can_publish: {
                  union: {
                    child: [
                      { computedUserset: { object: "", relation: "owner" } },
                      { computedUserset: { object: "", relation: "admin" } },
                      { computedUserset: { object: "", relation: "superadmin_access" } },
                    ],
                  },
                },
              },
              metadata: {
                relations: {
                  owner: {
                    directly_related_user_types: [
                      { type: "user" },
                      { type: "vendor", relation: "owner" },
                    ],
                  },
                  admin: {
                    directly_related_user_types: [
                      { type: "user" },
                      { type: "vendor", relation: "admin" },
                    ],
                  },
                  team_member: { directly_related_user_types: [{ type: "user" }] },
                  superadmin_access: { directly_related_user_types: [{ type: "user" }] },
                  can_view: { directly_related_user_types: [] },
                  can_edit: { directly_related_user_types: [] },
                  can_manage_documents: { directly_related_user_types: [] },
                  can_manage_team_members: { directly_related_user_types: [] },
                  can_publish: { directly_related_user_types: [] },
                },
              },
            },

            // ─── profile ─────────────────────────────────────────────
            {
              type: "profile",
              relations: {
                owner: { this: {} },
                superadmin_access: { this: {} },
                can_view: {
                  union: {
                    child: [
                      { computedUserset: { object: "", relation: "owner" } },
                      { computedUserset: { object: "", relation: "superadmin_access" } },
                    ],
                  },
                },
                can_edit: {
                  union: {
                    child: [
                      { computedUserset: { object: "", relation: "owner" } },
                      { computedUserset: { object: "", relation: "superadmin_access" } },
                    ],
                  },
                },
              },
              metadata: {
                relations: {
                  owner: { directly_related_user_types: [{ type: "user" }] },
                  superadmin_access: { directly_related_user_types: [{ type: "user" }] },
                  can_view: { directly_related_user_types: [] },
                  can_edit: { directly_related_user_types: [] },
                },
              },
            },

            // ─── travelplan ──────────────────────────────────────────
            {
              type: "travelplan",
              relations: {
                owner: { this: {} },
                editor: { this: {} },
                suggester: { this: {} },
                viewer: { this: {} },
                superadmin_access: { this: {} },
                can_view: {
                  union: {
                    child: [
                      { computedUserset: { object: "", relation: "owner" } },
                      { computedUserset: { object: "", relation: "viewer" } },
                      { computedUserset: { object: "", relation: "editor" } },
                      { computedUserset: { object: "", relation: "suggester" } },
                      { computedUserset: { object: "", relation: "superadmin_access" } },
                    ],
                  },
                },
                can_edit: {
                  union: {
                    child: [
                      { computedUserset: { object: "", relation: "owner" } },
                      { computedUserset: { object: "", relation: "editor" } },
                      { computedUserset: { object: "", relation: "superadmin_access" } },
                    ],
                  },
                },
                can_suggest: {
                  union: {
                    child: [
                      { computedUserset: { object: "", relation: "owner" } },
                      { computedUserset: { object: "", relation: "editor" } },
                      { computedUserset: { object: "", relation: "suggester" } },
                      { computedUserset: { object: "", relation: "superadmin_access" } },
                    ],
                  },
                },
                can_delete: {
                  union: {
                    child: [
                      { computedUserset: { object: "", relation: "owner" } },
                      { computedUserset: { object: "", relation: "superadmin_access" } },
                    ],
                  },
                },
                can_share: {
                  union: {
                    child: [
                      { computedUserset: { object: "", relation: "owner" } },
                      { computedUserset: { object: "", relation: "superadmin_access" } },
                    ],
                  },
                },
                can_add_booking: {
                  union: {
                    child: [
                      { computedUserset: { object: "", relation: "owner" } },
                      { computedUserset: { object: "", relation: "editor" } },
                      { computedUserset: { object: "", relation: "superadmin_access" } },
                    ],
                  },
                },
                can_manage_collaborators: {
                  union: {
                    child: [
                      { computedUserset: { object: "", relation: "owner" } },
                      { computedUserset: { object: "", relation: "superadmin_access" } },
                    ],
                  },
                },
              },
              metadata: {
                relations: {
                  owner: { directly_related_user_types: [{ type: "user" }] },
                  editor: { directly_related_user_types: [{ type: "user" }] },
                  suggester: { directly_related_user_types: [{ type: "user" }] },
                  viewer: { directly_related_user_types: [{ type: "user" }] },
                  superadmin_access: { directly_related_user_types: [{ type: "user" }] },
                  can_view: { directly_related_user_types: [] },
                  can_edit: { directly_related_user_types: [] },
                  can_suggest: { directly_related_user_types: [] },
                  can_delete: { directly_related_user_types: [] },
                  can_share: { directly_related_user_types: [] },
                  can_add_booking: { directly_related_user_types: [] },
                  can_manage_collaborators: { directly_related_user_types: [] },
                },
              },
            },

            // ─── accommodation ───────────────────────────────────────
            {
              type: "accommodation",
              relations: {
                owner: { this: {} },
                manager: { this: {} },
                editor: { this: {} },
                viewer: { this: {} },
                superadmin_access: { this: {} },
                can_view: {
                  union: {
                    child: [
                      { computedUserset: { object: "", relation: "owner" } },
                      { computedUserset: { object: "", relation: "manager" } },
                      { computedUserset: { object: "", relation: "editor" } },
                      { computedUserset: { object: "", relation: "viewer" } },
                      { computedUserset: { object: "", relation: "superadmin_access" } },
                    ],
                  },
                },
                can_edit: {
                  union: {
                    child: [
                      { computedUserset: { object: "", relation: "owner" } },
                      { computedUserset: { object: "", relation: "manager" } },
                      { computedUserset: { object: "", relation: "editor" } },
                      { computedUserset: { object: "", relation: "superadmin_access" } },
                    ],
                  },
                },
                can_manage_rooms: {
                  union: {
                    child: [
                      { computedUserset: { object: "", relation: "owner" } },
                      { computedUserset: { object: "", relation: "manager" } },
                      { computedUserset: { object: "", relation: "superadmin_access" } },
                    ],
                  },
                },
                can_manage_services: {
                  union: {
                    child: [
                      { computedUserset: { object: "", relation: "owner" } },
                      { computedUserset: { object: "", relation: "manager" } },
                      { computedUserset: { object: "", relation: "superadmin_access" } },
                    ],
                  },
                },
                can_update_availability: {
                  union: {
                    child: [
                      { computedUserset: { object: "", relation: "owner" } },
                      { computedUserset: { object: "", relation: "manager" } },
                      { computedUserset: { object: "", relation: "superadmin_access" } },
                    ],
                  },
                },
                can_publish: {
                  union: {
                    child: [
                      { computedUserset: { object: "", relation: "owner" } },
                      { computedUserset: { object: "", relation: "manager" } },
                      { computedUserset: { object: "", relation: "superadmin_access" } },
                    ],
                  },
                },
                can_delete: {
                  union: {
                    child: [
                      { computedUserset: { object: "", relation: "owner" } },
                      { computedUserset: { object: "", relation: "superadmin_access" } },
                    ],
                  },
                },
              },
              metadata: {
                relations: {
                  owner: {
                    directly_related_user_types: [
                      { type: "user" },
                      { type: "vendor", relation: "can_sell_accommodations" },
                    ],
                  },
                  manager: { directly_related_user_types: [{ type: "user" }] },
                  editor: { directly_related_user_types: [{ type: "user" }] },
                  viewer: { directly_related_user_types: [{ type: "user" }] },
                  superadmin_access: { directly_related_user_types: [{ type: "user" }] },
                  can_view: { directly_related_user_types: [] },
                  can_edit: { directly_related_user_types: [] },
                  can_manage_rooms: { directly_related_user_types: [] },
                  can_manage_services: { directly_related_user_types: [] },
                  can_update_availability: { directly_related_user_types: [] },
                  can_publish: { directly_related_user_types: [] },
                  can_delete: { directly_related_user_types: [] },
                },
              },
            },

            // ─── accommodation_room ──────────────────────────────────
            {
              type: "accommodation_room",
              relations: {
                owner: { this: {} },
                parent_accommodation: { this: {} },
                superadmin_access: { this: {} },
                can_view: {
                  union: {
                    child: [
                      { computedUserset: { object: "", relation: "owner" } },
                      { tupleToUserset: { tupleset: { object: "", relation: "parent_accommodation" }, computedUserset: { object: "", relation: "viewer" } } },
                      { computedUserset: { object: "", relation: "superadmin_access" } },
                    ],
                  },
                },
                can_edit: {
                  union: {
                    child: [
                      { computedUserset: { object: "", relation: "owner" } },
                      { tupleToUserset: { tupleset: { object: "", relation: "parent_accommodation" }, computedUserset: { object: "", relation: "editor" } } },
                      { computedUserset: { object: "", relation: "superadmin_access" } },
                    ],
                  },
                },
                can_delete: {
                  union: {
                    child: [
                      { computedUserset: { object: "", relation: "owner" } },
                      { tupleToUserset: { tupleset: { object: "", relation: "parent_accommodation" }, computedUserset: { object: "", relation: "manager" } } },
                      { computedUserset: { object: "", relation: "superadmin_access" } },
                    ],
                  },
                },
              },
              metadata: {
                relations: {
                  owner: { directly_related_user_types: [{ type: "user" }] },
                  parent_accommodation: { directly_related_user_types: [{ type: "accommodation" }] },
                  superadmin_access: { directly_related_user_types: [{ type: "user" }] },
                  can_view: { directly_related_user_types: [] },
                  can_edit: { directly_related_user_types: [] },
                  can_delete: { directly_related_user_types: [] },
                },
              },
            },

            // ─── accommodation_service ───────────────────────────────
            {
              type: "accommodation_service",
              relations: {
                owner: { this: {} },
                parent_accommodation: { this: {} },
                superadmin_access: { this: {} },
                can_view: {
                  union: {
                    child: [
                      { computedUserset: { object: "", relation: "owner" } },
                      { tupleToUserset: { tupleset: { object: "", relation: "parent_accommodation" }, computedUserset: { object: "", relation: "viewer" } } },
                      { computedUserset: { object: "", relation: "superadmin_access" } },
                    ],
                  },
                },
                can_edit: {
                  union: {
                    child: [
                      { computedUserset: { object: "", relation: "owner" } },
                      { tupleToUserset: { tupleset: { object: "", relation: "parent_accommodation" }, computedUserset: { object: "", relation: "editor" } } },
                      { computedUserset: { object: "", relation: "superadmin_access" } },
                    ],
                  },
                },
                can_delete: {
                  union: {
                    child: [
                      { computedUserset: { object: "", relation: "owner" } },
                      { tupleToUserset: { tupleset: { object: "", relation: "parent_accommodation" }, computedUserset: { object: "", relation: "manager" } } },
                      { computedUserset: { object: "", relation: "superadmin_access" } },
                    ],
                  },
                },
              },
              metadata: {
                relations: {
                  owner: { directly_related_user_types: [{ type: "user" }] },
                  parent_accommodation: { directly_related_user_types: [{ type: "accommodation" }] },
                  superadmin_access: { directly_related_user_types: [{ type: "user" }] },
                  can_view: { directly_related_user_types: [] },
                  can_edit: { directly_related_user_types: [] },
                  can_delete: { directly_related_user_types: [] },
                },
              },
            },

            // ─── accommodation_booking ───────────────────────────────
            {
              type: "accommodation_booking",
              relations: {
                owner: { this: {} },
                parent_travelplan: { this: {} },
                superadmin_access: { this: {} },
                can_view: {
                  union: {
                    child: [
                      { computedUserset: { object: "", relation: "owner" } },
                      { tupleToUserset: { tupleset: { object: "", relation: "parent_travelplan" }, computedUserset: { object: "", relation: "viewer" } } },
                      { tupleToUserset: { tupleset: { object: "", relation: "parent_travelplan" }, computedUserset: { object: "", relation: "editor" } } },
                      { tupleToUserset: { tupleset: { object: "", relation: "parent_travelplan" }, computedUserset: { object: "", relation: "suggester" } } },
                      { tupleToUserset: { tupleset: { object: "", relation: "parent_travelplan" }, computedUserset: { object: "", relation: "superadmin_access" } } },
                      { computedUserset: { object: "", relation: "superadmin_access" } },
                    ],
                  },
                },
                can_edit: {
                  union: {
                    child: [
                      { computedUserset: { object: "", relation: "owner" } },
                      { tupleToUserset: { tupleset: { object: "", relation: "parent_travelplan" }, computedUserset: { object: "", relation: "editor" } } },
                      { tupleToUserset: { tupleset: { object: "", relation: "parent_travelplan" }, computedUserset: { object: "", relation: "superadmin_access" } } },
                      { computedUserset: { object: "", relation: "superadmin_access" } },
                    ],
                  },
                },
                can_cancel: {
                  union: {
                    child: [
                      { computedUserset: { object: "", relation: "owner" } },
                      { tupleToUserset: { tupleset: { object: "", relation: "parent_travelplan" }, computedUserset: { object: "", relation: "editor" } } },
                      { tupleToUserset: { tupleset: { object: "", relation: "parent_travelplan" }, computedUserset: { object: "", relation: "superadmin_access" } } },
                      { computedUserset: { object: "", relation: "superadmin_access" } },
                    ],
                  },
                },
              },
              metadata: {
                relations: {
                  owner: { directly_related_user_types: [{ type: "user" }] },
                  parent_travelplan: { directly_related_user_types: [{ type: "travelplan" }] },
                  superadmin_access: { directly_related_user_types: [{ type: "user" }] },
                  can_view: { directly_related_user_types: [] },
                  can_edit: { directly_related_user_types: [] },
                  can_cancel: { directly_related_user_types: [] },
                },
              },
            },

            // ─── transportation_provider ─────────────────────────────
            {
              type: "transportation_provider",
              relations: {
                owner: { this: {} },
                manager: { this: {} },
                editor: { this: {} },
                viewer: { this: {} },
                superadmin_access: { this: {} },
                can_view: {
                  union: {
                    child: [
                      { computedUserset: { object: "", relation: "owner" } },
                      { computedUserset: { object: "", relation: "manager" } },
                      { computedUserset: { object: "", relation: "editor" } },
                      { computedUserset: { object: "", relation: "viewer" } },
                      { computedUserset: { object: "", relation: "superadmin_access" } },
                    ],
                  },
                },
                can_edit: {
                  union: {
                    child: [
                      { computedUserset: { object: "", relation: "owner" } },
                      { computedUserset: { object: "", relation: "manager" } },
                      { computedUserset: { object: "", relation: "editor" } },
                      { computedUserset: { object: "", relation: "superadmin_access" } },
                    ],
                  },
                },
                can_manage_vehicles: {
                  union: {
                    child: [
                      { computedUserset: { object: "", relation: "owner" } },
                      { computedUserset: { object: "", relation: "manager" } },
                      { computedUserset: { object: "", relation: "superadmin_access" } },
                    ],
                  },
                },
                can_update_availability: {
                  union: {
                    child: [
                      { computedUserset: { object: "", relation: "owner" } },
                      { computedUserset: { object: "", relation: "manager" } },
                      { computedUserset: { object: "", relation: "superadmin_access" } },
                    ],
                  },
                },
                can_publish: {
                  union: {
                    child: [
                      { computedUserset: { object: "", relation: "owner" } },
                      { computedUserset: { object: "", relation: "manager" } },
                      { computedUserset: { object: "", relation: "superadmin_access" } },
                    ],
                  },
                },
                can_delete: {
                  union: {
                    child: [
                      { computedUserset: { object: "", relation: "owner" } },
                      { computedUserset: { object: "", relation: "superadmin_access" } },
                    ],
                  },
                },
              },
              metadata: {
                relations: {
                  owner: {
                    directly_related_user_types: [
                      { type: "user" },
                      { type: "vendor", relation: "can_sell_transportation" },
                    ],
                  },
                  manager: { directly_related_user_types: [{ type: "user" }] },
                  editor: { directly_related_user_types: [{ type: "user" }] },
                  viewer: { directly_related_user_types: [{ type: "user" }] },
                  superadmin_access: { directly_related_user_types: [{ type: "user" }] },
                  can_view: { directly_related_user_types: [] },
                  can_edit: { directly_related_user_types: [] },
                  can_manage_vehicles: { directly_related_user_types: [] },
                  can_update_availability: { directly_related_user_types: [] },
                  can_publish: { directly_related_user_types: [] },
                  can_delete: { directly_related_user_types: [] },
                },
              },
            },

            // ─── transportation_vehicle ──────────────────────────────
            {
              type: "transportation_vehicle",
              relations: {
                owner: { this: {} },
                parent_provider: { this: {} },
                superadmin_access: { this: {} },
                can_view: {
                  union: {
                    child: [
                      { computedUserset: { object: "", relation: "owner" } },
                      { tupleToUserset: { tupleset: { object: "", relation: "parent_provider" }, computedUserset: { object: "", relation: "viewer" } } },
                      { computedUserset: { object: "", relation: "superadmin_access" } },
                    ],
                  },
                },
                can_edit: {
                  union: {
                    child: [
                      { computedUserset: { object: "", relation: "owner" } },
                      { tupleToUserset: { tupleset: { object: "", relation: "parent_provider" }, computedUserset: { object: "", relation: "editor" } } },
                      { computedUserset: { object: "", relation: "superadmin_access" } },
                    ],
                  },
                },
                can_delete: {
                  union: {
                    child: [
                      { computedUserset: { object: "", relation: "owner" } },
                      { tupleToUserset: { tupleset: { object: "", relation: "parent_provider" }, computedUserset: { object: "", relation: "manager" } } },
                      { computedUserset: { object: "", relation: "superadmin_access" } },
                    ],
                  },
                },
              },
              metadata: {
                relations: {
                  owner: { directly_related_user_types: [{ type: "user" }] },
                  parent_provider: { directly_related_user_types: [{ type: "transportation_provider" }] },
                  superadmin_access: { directly_related_user_types: [{ type: "user" }] },
                  can_view: { directly_related_user_types: [] },
                  can_edit: { directly_related_user_types: [] },
                  can_delete: { directly_related_user_types: [] },
                },
              },
            },

            // ─── transportation_booking ──────────────────────────────
            {
              type: "transportation_booking",
              relations: {
                owner: { this: {} },
                parent_travelplan: { this: {} },
                superadmin_access: { this: {} },
                can_view: {
                  union: {
                    child: [
                      { computedUserset: { object: "", relation: "owner" } },
                      { tupleToUserset: { tupleset: { object: "", relation: "parent_travelplan" }, computedUserset: { object: "", relation: "viewer" } } },
                      { tupleToUserset: { tupleset: { object: "", relation: "parent_travelplan" }, computedUserset: { object: "", relation: "editor" } } },
                      { tupleToUserset: { tupleset: { object: "", relation: "parent_travelplan" }, computedUserset: { object: "", relation: "suggester" } } },
                      { tupleToUserset: { tupleset: { object: "", relation: "parent_travelplan" }, computedUserset: { object: "", relation: "superadmin_access" } } },
                      { computedUserset: { object: "", relation: "superadmin_access" } },
                    ],
                  },
                },
                can_edit: {
                  union: {
                    child: [
                      { computedUserset: { object: "", relation: "owner" } },
                      { tupleToUserset: { tupleset: { object: "", relation: "parent_travelplan" }, computedUserset: { object: "", relation: "editor" } } },
                      { tupleToUserset: { tupleset: { object: "", relation: "parent_travelplan" }, computedUserset: { object: "", relation: "superadmin_access" } } },
                      { computedUserset: { object: "", relation: "superadmin_access" } },
                    ],
                  },
                },
                can_cancel: {
                  union: {
                    child: [
                      { computedUserset: { object: "", relation: "owner" } },
                      { tupleToUserset: { tupleset: { object: "", relation: "parent_travelplan" }, computedUserset: { object: "", relation: "editor" } } },
                      { tupleToUserset: { tupleset: { object: "", relation: "parent_travelplan" }, computedUserset: { object: "", relation: "superadmin_access" } } },
                      { computedUserset: { object: "", relation: "superadmin_access" } },
                    ],
                  },
                },
              },
              metadata: {
                relations: {
                  owner: { directly_related_user_types: [{ type: "user" }] },
                  parent_travelplan: { directly_related_user_types: [{ type: "travelplan" }] },
                  superadmin_access: { directly_related_user_types: [{ type: "user" }] },
                  can_view: { directly_related_user_types: [] },
                  can_edit: { directly_related_user_types: [] },
                  can_cancel: { directly_related_user_types: [] },
                },
              },
            },

            // ─── travel_package ──────────────────────────────────────
            {
              type: "travel_package",
              relations: {
                owner: { this: {} },
                manager: { this: {} },
                editor: { this: {} },
                viewer: { this: {} },
                superadmin_access: { this: {} },
                can_view: {
                  union: {
                    child: [
                      { computedUserset: { object: "", relation: "owner" } },
                      { computedUserset: { object: "", relation: "manager" } },
                      { computedUserset: { object: "", relation: "editor" } },
                      { computedUserset: { object: "", relation: "viewer" } },
                      { computedUserset: { object: "", relation: "superadmin_access" } },
                    ],
                  },
                },
                can_edit: {
                  union: {
                    child: [
                      { computedUserset: { object: "", relation: "owner" } },
                      { computedUserset: { object: "", relation: "manager" } },
                      { computedUserset: { object: "", relation: "editor" } },
                      { computedUserset: { object: "", relation: "superadmin_access" } },
                    ],
                  },
                },
                can_update_availability: {
                  union: {
                    child: [
                      { computedUserset: { object: "", relation: "owner" } },
                      { computedUserset: { object: "", relation: "manager" } },
                      { computedUserset: { object: "", relation: "superadmin_access" } },
                    ],
                  },
                },
                can_publish: {
                  union: {
                    child: [
                      { computedUserset: { object: "", relation: "owner" } },
                      { computedUserset: { object: "", relation: "manager" } },
                      { computedUserset: { object: "", relation: "superadmin_access" } },
                    ],
                  },
                },
                can_delete: {
                  union: {
                    child: [
                      { computedUserset: { object: "", relation: "owner" } },
                      { computedUserset: { object: "", relation: "superadmin_access" } },
                    ],
                  },
                },
              },
              metadata: {
                relations: {
                  owner: {
                    directly_related_user_types: [
                      { type: "user" },
                      { type: "vendor", relation: "can_sell_packages" },
                    ],
                  },
                  manager: { directly_related_user_types: [{ type: "user" }] },
                  editor: { directly_related_user_types: [{ type: "user" }] },
                  viewer: { directly_related_user_types: [{ type: "user" }] },
                  superadmin_access: { directly_related_user_types: [{ type: "user" }] },
                  can_view: { directly_related_user_types: [] },
                  can_edit: { directly_related_user_types: [] },
                  can_update_availability: { directly_related_user_types: [] },
                  can_publish: { directly_related_user_types: [] },
                  can_delete: { directly_related_user_types: [] },
                },
              },
            },

            // ─── travel_package_booking ──────────────────────────────
            {
              type: "travel_package_booking",
              relations: {
                owner: { this: {} },
                parent_travelplan: { this: {} },
                parent_package: { this: {} },
                superadmin_access: { this: {} },
                can_view: {
                  union: {
                    child: [
                      { computedUserset: { object: "", relation: "owner" } },
                      { tupleToUserset: { tupleset: { object: "", relation: "parent_travelplan" }, computedUserset: { object: "", relation: "viewer" } } },
                      { tupleToUserset: { tupleset: { object: "", relation: "parent_travelplan" }, computedUserset: { object: "", relation: "editor" } } },
                      { tupleToUserset: { tupleset: { object: "", relation: "parent_travelplan" }, computedUserset: { object: "", relation: "suggester" } } },
                      { tupleToUserset: { tupleset: { object: "", relation: "parent_package" }, computedUserset: { object: "", relation: "viewer" } } },
                      { tupleToUserset: { tupleset: { object: "", relation: "parent_package" }, computedUserset: { object: "", relation: "editor" } } },
                      { tupleToUserset: { tupleset: { object: "", relation: "parent_travelplan" }, computedUserset: { object: "", relation: "superadmin_access" } } },
                      { computedUserset: { object: "", relation: "superadmin_access" } },
                    ],
                  },
                },
                can_edit: {
                  union: {
                    child: [
                      { computedUserset: { object: "", relation: "owner" } },
                      { tupleToUserset: { tupleset: { object: "", relation: "parent_travelplan" }, computedUserset: { object: "", relation: "editor" } } },
                      { tupleToUserset: { tupleset: { object: "", relation: "parent_package" }, computedUserset: { object: "", relation: "editor" } } },
                      { tupleToUserset: { tupleset: { object: "", relation: "parent_travelplan" }, computedUserset: { object: "", relation: "superadmin_access" } } },
                      { computedUserset: { object: "", relation: "superadmin_access" } },
                    ],
                  },
                },
                can_cancel: {
                  union: {
                    child: [
                      { computedUserset: { object: "", relation: "owner" } },
                      { tupleToUserset: { tupleset: { object: "", relation: "parent_travelplan" }, computedUserset: { object: "", relation: "editor" } } },
                      { tupleToUserset: { tupleset: { object: "", relation: "parent_travelplan" }, computedUserset: { object: "", relation: "superadmin_access" } } },
                      { computedUserset: { object: "", relation: "superadmin_access" } },
                    ],
                  },
                },
              },
              metadata: {
                relations: {
                  owner: { directly_related_user_types: [{ type: "user" }] },
                  parent_travelplan: { directly_related_user_types: [{ type: "travelplan" }] },
                  parent_package: { directly_related_user_types: [{ type: "travel_package" }] },
                  superadmin_access: { directly_related_user_types: [{ type: "user" }] },
                  can_view: { directly_related_user_types: [] },
                  can_edit: { directly_related_user_types: [] },
                  can_cancel: { directly_related_user_types: [] },
                },
              },
            },

            // ─── vendor_experience ───────────────────────────────────
            {
              type: "vendor_experience",
              relations: {
                owner: { this: {} },
                manager: { this: {} },
                editor: { this: {} },
                viewer: { this: {} },
                superadmin_access: { this: {} },
                can_view: {
                  union: {
                    child: [
                      { computedUserset: { object: "", relation: "owner" } },
                      { computedUserset: { object: "", relation: "manager" } },
                      { computedUserset: { object: "", relation: "editor" } },
                      { computedUserset: { object: "", relation: "viewer" } },
                      { computedUserset: { object: "", relation: "superadmin_access" } },
                    ],
                  },
                },
                can_edit: {
                  union: {
                    child: [
                      { computedUserset: { object: "", relation: "owner" } },
                      { computedUserset: { object: "", relation: "manager" } },
                      { computedUserset: { object: "", relation: "editor" } },
                      { computedUserset: { object: "", relation: "superadmin_access" } },
                    ],
                  },
                },
                can_update_availability: {
                  union: {
                    child: [
                      { computedUserset: { object: "", relation: "owner" } },
                      { computedUserset: { object: "", relation: "manager" } },
                      { computedUserset: { object: "", relation: "superadmin_access" } },
                    ],
                  },
                },
                can_publish: {
                  union: {
                    child: [
                      { computedUserset: { object: "", relation: "owner" } },
                      { computedUserset: { object: "", relation: "manager" } },
                      { computedUserset: { object: "", relation: "superadmin_access" } },
                    ],
                  },
                },
                can_delete: {
                  union: {
                    child: [
                      { computedUserset: { object: "", relation: "owner" } },
                      { computedUserset: { object: "", relation: "superadmin_access" } },
                    ],
                  },
                },
              },
              metadata: {
                relations: {
                  owner: {
                    directly_related_user_types: [
                      { type: "user" },
                      { type: "vendor", relation: "can_sell_experiences" },
                    ],
                  },
                  manager: { directly_related_user_types: [{ type: "user" }] },
                  editor: { directly_related_user_types: [{ type: "user" }] },
                  viewer: { directly_related_user_types: [{ type: "user" }] },
                  superadmin_access: { directly_related_user_types: [{ type: "user" }] },
                  can_view: { directly_related_user_types: [] },
                  can_edit: { directly_related_user_types: [] },
                  can_update_availability: { directly_related_user_types: [] },
                  can_publish: { directly_related_user_types: [] },
                  can_delete: { directly_related_user_types: [] },
                },
              },
            },

            // ─── experience_booking ──────────────────────────────────
            {
              type: "experience_booking",
              relations: {
                owner: { this: {} },
                parent_travelplan: { this: {} },
                parent_experience: { this: {} },
                superadmin_access: { this: {} },
                can_view: {
                  union: {
                    child: [
                      { computedUserset: { object: "", relation: "owner" } },
                      { tupleToUserset: { tupleset: { object: "", relation: "parent_travelplan" }, computedUserset: { object: "", relation: "viewer" } } },
                      { tupleToUserset: { tupleset: { object: "", relation: "parent_travelplan" }, computedUserset: { object: "", relation: "editor" } } },
                      { tupleToUserset: { tupleset: { object: "", relation: "parent_travelplan" }, computedUserset: { object: "", relation: "suggester" } } },
                      { tupleToUserset: { tupleset: { object: "", relation: "parent_experience" }, computedUserset: { object: "", relation: "viewer" } } },
                      { tupleToUserset: { tupleset: { object: "", relation: "parent_experience" }, computedUserset: { object: "", relation: "editor" } } },
                      { tupleToUserset: { tupleset: { object: "", relation: "parent_travelplan" }, computedUserset: { object: "", relation: "superadmin_access" } } },
                      { computedUserset: { object: "", relation: "superadmin_access" } },
                    ],
                  },
                },
                can_edit: {
                  union: {
                    child: [
                      { computedUserset: { object: "", relation: "owner" } },
                      { tupleToUserset: { tupleset: { object: "", relation: "parent_travelplan" }, computedUserset: { object: "", relation: "editor" } } },
                      { tupleToUserset: { tupleset: { object: "", relation: "parent_experience" }, computedUserset: { object: "", relation: "editor" } } },
                      { tupleToUserset: { tupleset: { object: "", relation: "parent_travelplan" }, computedUserset: { object: "", relation: "superadmin_access" } } },
                      { computedUserset: { object: "", relation: "superadmin_access" } },
                    ],
                  },
                },
                can_cancel: {
                  union: {
                    child: [
                      { computedUserset: { object: "", relation: "owner" } },
                      { tupleToUserset: { tupleset: { object: "", relation: "parent_travelplan" }, computedUserset: { object: "", relation: "editor" } } },
                      { tupleToUserset: { tupleset: { object: "", relation: "parent_travelplan" }, computedUserset: { object: "", relation: "superadmin_access" } } },
                      { computedUserset: { object: "", relation: "superadmin_access" } },
                    ],
                  },
                },
              },
              metadata: {
                relations: {
                  owner: { directly_related_user_types: [{ type: "user" }] },
                  parent_travelplan: { directly_related_user_types: [{ type: "travelplan" }] },
                  parent_experience: { directly_related_user_types: [{ type: "vendor_experience" }] },
                  superadmin_access: { directly_related_user_types: [{ type: "user" }] },
                  can_view: { directly_related_user_types: [] },
                  can_edit: { directly_related_user_types: [] },
                  can_cancel: { directly_related_user_types: [] },
                },
              },
            },

            // ─── retail_store ────────────────────────────────────────
            {
              type: "retail_store",
              relations: {
                owner: { this: {} },
                manager: { this: {} },
                editor: { this: {} },
                viewer: { this: {} },
                superadmin_access: { this: {} },
                can_view: {
                  union: {
                    child: [
                      { computedUserset: { object: "", relation: "owner" } },
                      { computedUserset: { object: "", relation: "manager" } },
                      { computedUserset: { object: "", relation: "editor" } },
                      { computedUserset: { object: "", relation: "viewer" } },
                      { computedUserset: { object: "", relation: "superadmin_access" } },
                    ],
                  },
                },
                can_edit: {
                  union: {
                    child: [
                      { computedUserset: { object: "", relation: "owner" } },
                      { computedUserset: { object: "", relation: "manager" } },
                      { computedUserset: { object: "", relation: "editor" } },
                      { computedUserset: { object: "", relation: "superadmin_access" } },
                    ],
                  },
                },
                can_manage_products: {
                  union: {
                    child: [
                      { computedUserset: { object: "", relation: "owner" } },
                      { computedUserset: { object: "", relation: "manager" } },
                      { computedUserset: { object: "", relation: "superadmin_access" } },
                    ],
                  },
                },
                can_update_inventory: {
                  union: {
                    child: [
                      { computedUserset: { object: "", relation: "owner" } },
                      { computedUserset: { object: "", relation: "manager" } },
                      { computedUserset: { object: "", relation: "superadmin_access" } },
                    ],
                  },
                },
                can_publish: {
                  union: {
                    child: [
                      { computedUserset: { object: "", relation: "owner" } },
                      { computedUserset: { object: "", relation: "manager" } },
                      { computedUserset: { object: "", relation: "superadmin_access" } },
                    ],
                  },
                },
                can_delete: {
                  union: {
                    child: [
                      { computedUserset: { object: "", relation: "owner" } },
                      { computedUserset: { object: "", relation: "superadmin_access" } },
                    ],
                  },
                },
              },
              metadata: {
                relations: {
                  owner: {
                    directly_related_user_types: [
                      { type: "user" },
                      { type: "vendor", relation: "can_sell_shopping" },
                    ],
                  },
                  manager: { directly_related_user_types: [{ type: "user" }] },
                  editor: { directly_related_user_types: [{ type: "user" }] },
                  viewer: { directly_related_user_types: [{ type: "user" }] },
                  superadmin_access: { directly_related_user_types: [{ type: "user" }] },
                  can_view: { directly_related_user_types: [] },
                  can_edit: { directly_related_user_types: [] },
                  can_manage_products: { directly_related_user_types: [] },
                  can_update_inventory: { directly_related_user_types: [] },
                  can_publish: { directly_related_user_types: [] },
                  can_delete: { directly_related_user_types: [] },
                },
              },
            },

            // ─── retail_product ──────────────────────────────────────
            {
              type: "retail_product",
              relations: {
                owner: { this: {} },
                parent_store: { this: {} },
                superadmin_access: { this: {} },
                can_view: {
                  union: {
                    child: [
                      { computedUserset: { object: "", relation: "owner" } },
                      { tupleToUserset: { tupleset: { object: "", relation: "parent_store" }, computedUserset: { object: "", relation: "viewer" } } },
                      { computedUserset: { object: "", relation: "superadmin_access" } },
                    ],
                  },
                },
                can_edit: {
                  union: {
                    child: [
                      { computedUserset: { object: "", relation: "owner" } },
                      { tupleToUserset: { tupleset: { object: "", relation: "parent_store" }, computedUserset: { object: "", relation: "editor" } } },
                      { computedUserset: { object: "", relation: "superadmin_access" } },
                    ],
                  },
                },
                can_delete: {
                  union: {
                    child: [
                      { computedUserset: { object: "", relation: "owner" } },
                      { tupleToUserset: { tupleset: { object: "", relation: "parent_store" }, computedUserset: { object: "", relation: "manager" } } },
                      { computedUserset: { object: "", relation: "superadmin_access" } },
                    ],
                  },
                },
              },
              metadata: {
                relations: {
                  owner: { directly_related_user_types: [{ type: "user" }] },
                  parent_store: { directly_related_user_types: [{ type: "retail_store" }] },
                  superadmin_access: { directly_related_user_types: [{ type: "user" }] },
                  can_view: { directly_related_user_types: [] },
                  can_edit: { directly_related_user_types: [] },
                  can_delete: { directly_related_user_types: [] },
                },
              },
            },

            // ─── shopping_visit ──────────────────────────────────────
            {
              type: "shopping_visit",
              relations: {
                owner: { this: {} },
                parent_travelplan: { this: {} },
                superadmin_access: { this: {} },
                can_view: {
                  union: {
                    child: [
                      { computedUserset: { object: "", relation: "owner" } },
                      { tupleToUserset: { tupleset: { object: "", relation: "parent_travelplan" }, computedUserset: { object: "", relation: "viewer" } } },
                      { tupleToUserset: { tupleset: { object: "", relation: "parent_travelplan" }, computedUserset: { object: "", relation: "editor" } } },
                      { tupleToUserset: { tupleset: { object: "", relation: "parent_travelplan" }, computedUserset: { object: "", relation: "suggester" } } },
                      { tupleToUserset: { tupleset: { object: "", relation: "parent_travelplan" }, computedUserset: { object: "", relation: "superadmin_access" } } },
                      { computedUserset: { object: "", relation: "superadmin_access" } },
                    ],
                  },
                },
                can_edit: {
                  union: {
                    child: [
                      { computedUserset: { object: "", relation: "owner" } },
                      { tupleToUserset: { tupleset: { object: "", relation: "parent_travelplan" }, computedUserset: { object: "", relation: "editor" } } },
                      { tupleToUserset: { tupleset: { object: "", relation: "parent_travelplan" }, computedUserset: { object: "", relation: "superadmin_access" } } },
                      { computedUserset: { object: "", relation: "superadmin_access" } },
                    ],
                  },
                },
                can_cancel: {
                  union: {
                    child: [
                      { computedUserset: { object: "", relation: "owner" } },
                      { tupleToUserset: { tupleset: { object: "", relation: "parent_travelplan" }, computedUserset: { object: "", relation: "editor" } } },
                      { tupleToUserset: { tupleset: { object: "", relation: "parent_travelplan" }, computedUserset: { object: "", relation: "superadmin_access" } } },
                      { computedUserset: { object: "", relation: "superadmin_access" } },
                    ],
                  },
                },
              },
              metadata: {
                relations: {
                  owner: { directly_related_user_types: [{ type: "user" }] },
                  parent_travelplan: { directly_related_user_types: [{ type: "travelplan" }] },
                  superadmin_access: { directly_related_user_types: [{ type: "user" }] },
                  can_view: { directly_related_user_types: [] },
                  can_edit: { directly_related_user_types: [] },
                  can_cancel: { directly_related_user_types: [] },
                },
              },
            },

            // ─── transaction ─────────────────────────────────────────
            {
              type: "transaction",
              relations: {
                owner: { this: {} },
                superadmin_access: { this: {} },
                can_view: {
                  union: {
                    child: [
                      { computedUserset: { object: "", relation: "owner" } },
                      { computedUserset: { object: "", relation: "superadmin_access" } },
                    ],
                  },
                },
                can_refund: { computedUserset: { object: "", relation: "superadmin_access" } },
              },
              metadata: {
                relations: {
                  owner: {
                    directly_related_user_types: [
                      { type: "user" },
                      { type: "vendor", relation: "owner" },
                    ],
                  },
                  superadmin_access: { directly_related_user_types: [{ type: "user" }] },
                  can_view: { directly_related_user_types: [] },
                  can_refund: { directly_related_user_types: [] },
                },
              },
            },

            // ─── payout ──────────────────────────────────────────────
            {
              type: "payout",
              relations: {
                owner: { this: {} },
                superadmin_access: { this: {} },
                can_view: {
                  union: {
                    child: [
                      { computedUserset: { object: "", relation: "owner" } },
                      { computedUserset: { object: "", relation: "superadmin_access" } },
                    ],
                  },
                },
                can_cancel: {
                  union: {
                    child: [
                      { computedUserset: { object: "", relation: "owner" } },
                      { computedUserset: { object: "", relation: "superadmin_access" } },
                    ],
                  },
                },
                can_process: { computedUserset: { object: "", relation: "superadmin_access" } },
                can_request: { computedUserset: { object: "", relation: "owner" } },
              },
              metadata: {
                relations: {
                  owner: {
                    directly_related_user_types: [
                      { type: "user" },
                      { type: "vendor", relation: "owner" },
                    ],
                  },
                  superadmin_access: { directly_related_user_types: [{ type: "user" }] },
                  can_view: { directly_related_user_types: [] },
                  can_cancel: { directly_related_user_types: [] },
                  can_process: { directly_related_user_types: [] },
                  can_request: { directly_related_user_types: [] },
                },
              },
            },

            // ─── vendor_review ───────────────────────────────────────
            {
              type: "vendor_review",
              relations: {
                author: { this: {} },
                vendor: { this: {} },
                superadmin_access: { this: {} },
                can_flag: { this: {} },
                can_view: {
                  union: {
                    child: [
                      { computedUserset: { object: "", relation: "author" } },
                      { computedUserset: { object: "", relation: "vendor" } },
                      { computedUserset: { object: "", relation: "superadmin_access" } },
                    ],
                  },
                },
                can_edit: {
                  union: {
                    child: [
                      { computedUserset: { object: "", relation: "author" } },
                      { computedUserset: { object: "", relation: "superadmin_access" } },
                    ],
                  },
                },
                can_delete: {
                  union: {
                    child: [
                      { computedUserset: { object: "", relation: "author" } },
                      { computedUserset: { object: "", relation: "superadmin_access" } },
                    ],
                  },
                },
                can_respond: {
                  union: {
                    child: [
                      { computedUserset: { object: "", relation: "vendor" } },
                      { computedUserset: { object: "", relation: "superadmin_access" } },
                    ],
                  },
                },
                can_hide: { computedUserset: { object: "", relation: "superadmin_access" } },
              },
              metadata: {
                relations: {
                  author: { directly_related_user_types: [{ type: "user" }] },
                  vendor: { directly_related_user_types: [{ type: "vendor" }] },
                  superadmin_access: { directly_related_user_types: [{ type: "user" }] },
                  can_flag: { directly_related_user_types: [{ type: "user" }] },
                  can_view: { directly_related_user_types: [] },
                  can_edit: { directly_related_user_types: [] },
                  can_delete: { directly_related_user_types: [] },
                  can_respond: { directly_related_user_types: [] },
                  can_hide: { directly_related_user_types: [] },
                },
              },
            },
          ],
        });

        this.modelId = model.authorization_model_id;
        console.log(`✓ Created new authorization model: ${this.modelId}`);
      }

      this.client = new OpenFgaClient({
        apiUrl,
        storeId: this.storeId,
        authorizationModelId: this.modelId,
      });

      this.initialized = true;
      console.log("✓ OpenFGA service fully initialized");
      process.env.OPENFGA_STORE_ID = this.storeId;
      process.env.OPENFGA_MODEL_ID = this.modelId;

      return true;
    } catch (error) {
      console.error("❌ OpenFGA initialization failed:", error.message);
      this.initialized = false;
      throw error;
    } finally {
      this.initializing = false;
    }
  }

  async ensureInitialized() {
    if (!this.initialized) await this.initialize();
    return this.client;
  }

  // ==================== WRITE / DELETE TUPLES ====================

  async writeTuples(tuples) {
    const client = await this.ensureInitialized();
    return client.writeTuples(tuples);
  }

  async deleteTuples(tuples) {
    const client = await this.ensureInitialized();
    return client.deleteTuples(tuples);
  }

  // ==================== SUPERADMIN ====================

  async assignSuperAdmin(userId) {
    const client = await this.ensureInitialized();
    return client.writeTuples([
      { user: `user:${userId}`, relation: "member", object: "superadmin:global" },
    ]);
  }

  async removeSuperAdmin(userId) {
    const client = await this.ensureInitialized();
    return client.deleteTuples([
      { user: `user:${userId}`, relation: "member", object: "superadmin:global" },
    ]);
  }

  async checkSuperAdmin(userId) {
    return this.checkPermission(userId, "can_manage_all", "superadmin:global");
  }

  async canApproveSuperAdminVendors(userId) {
    return this.checkPermission(userId, "can_approve_vendors", "superadmin:global");
  }

  async canManageSuperAdminPayouts(userId) {
    return this.checkPermission(userId, "can_manage_payouts", "superadmin:global");
  }

  // ==================== VENDOR APPLICATION ====================

  async createVendorApplication(userId, applicationId) {
    const client = await this.ensureInitialized();
    return client.writeTuples([
      { user: `user:${userId}`, relation: "applicant", object: `vendor_application:${applicationId}` },
    ]);
  }

  async assignApplicationReviewer(reviewerId, applicationId) {
    const client = await this.ensureInitialized();
    return client.writeTuples([
      { user: `user:${reviewerId}`, relation: "reviewer", object: `vendor_application:${applicationId}` },
    ]);
  }

  async canViewApplication(userId, applicationId) {
    return this.checkPermission(userId, "can_view", `vendor_application:${applicationId}`);
  }

  async canApproveApplication(userId, applicationId) {
    return this.checkPermission(userId, "can_approve", `vendor_application:${applicationId}`);
  }

  async canRejectApplication(userId, applicationId) {
    return this.checkPermission(userId, "can_reject", `vendor_application:${applicationId}`);
  }

  async canWithdrawApplication(userId, applicationId) {
    return this.checkPermission(userId, "can_withdraw", `vendor_application:${applicationId}`);
  }

  // ==================== VENDOR ====================

  async assignVendorOwner(userId, vendorId) {
    const client = await this.ensureInitialized();
    return client.writeTuples([
      { user: `user:${userId}`, relation: "owner", object: `vendor:${vendorId}` },
    ]);
  }

  async assignVendorAdmin(userId, vendorId) {
    const client = await this.ensureInitialized();
    return client.writeTuples([
      { user: `user:${userId}`, relation: "admin", object: `vendor:${vendorId}` },
    ]);
  }

  async revokeVendorAdmin(userId, vendorId) {
    const client = await this.ensureInitialized();
    return client.deleteTuples([
      { user: `user:${userId}`, relation: "admin", object: `vendor:${vendorId}` },
    ]);
  }

  async grantVendorSellingCapability(userId, vendorId, capability) {
    // capability: can_sell_accommodations | can_sell_transportation | etc.
    const client = await this.ensureInitialized();
    return client.writeTuples([
      { user: `user:${userId}`, relation: capability, object: `vendor:${vendorId}` },
    ]);
  }

  async revokeVendorSellingCapability(userId, vendorId, capability) {
    const client = await this.ensureInitialized();
    return client.deleteTuples([
      { user: `user:${userId}`, relation: capability, object: `vendor:${vendorId}` },
    ]);
  }

  async assignVendorSuperadminAccess(userId, vendorId) {
    const client = await this.ensureInitialized();
    return client.writeTuples([
      { user: `user:${userId}`, relation: "superadmin_access", object: `vendor:${vendorId}` },
    ]);
  }

  async isVendorOwner(userId) {
    try {
      const client = await this.ensureInitialized();
      const response = await client.listObjects({
        user: `user:${userId}`,
        relation: "owner",
        type: "vendor",
      });
      return response.objects.length > 0;
    } catch (error) {
      console.error("Error in isVendorOwner:", error);
      return false;
    }
  }

  async canVendorManageTeam(userId, vendorId) {
    return this.checkPermission(userId, "can_manage_team", `vendor:${vendorId}`);
  }

  async canVendorViewFinancials(userId, vendorId) {
    return this.checkPermission(userId, "can_view_financials", `vendor:${vendorId}`);
  }

  async canVendorRequestPayout(userId, vendorId) {
    return this.checkPermission(userId, "can_request_payout", `vendor:${vendorId}`);
  }

  async canVendorViewDashboard(userId, vendorId) {
    return this.checkPermission(userId, "can_view_dashboard", `vendor:${vendorId}`);
  }

  // ==================== VENDOR PROFILE ====================

  async createVendorProfileRelations(userId, profileId) {
    const client = await this.ensureInitialized();
    return client.writeTuples([
      { user: `user:${userId}`, relation: "owner", object: `vendor_profile:${profileId}` },
    ]);
  }

  async addVendorProfileAdmin(userId, profileId) {
    const client = await this.ensureInitialized();
    return client.writeTuples([
      { user: `user:${userId}`, relation: "admin", object: `vendor_profile:${profileId}` },
    ]);
  }

  async addVendorProfileTeamMember(userId, profileId) {
    const client = await this.ensureInitialized();
    return client.writeTuples([
      { user: `user:${userId}`, relation: "team_member", object: `vendor_profile:${profileId}` },
    ]);
  }

  async removeVendorProfileTeamMember(userId, profileId) {
    const client = await this.ensureInitialized();
    return client.deleteTuples([
      { user: `user:${userId}`, relation: "team_member", object: `vendor_profile:${profileId}` },
    ]);
  }

  async canViewVendorProfile(userId, profileId) {
    return this.checkPermission(userId, "can_view", `vendor_profile:${profileId}`);
  }

  async canEditVendorProfile(userId, profileId) {
    return this.checkPermission(userId, "can_edit", `vendor_profile:${profileId}`);
  }

  async canPublishVendorProfile(userId, profileId) {
    return this.checkPermission(userId, "can_publish", `vendor_profile:${profileId}`);
  }

  // ==================== PROFILE ====================

  async createProfileRelations(userId, profileId) {
    const client = await this.ensureInitialized();
    return client.writeTuples([
      { user: `user:${userId}`, relation: "owner", object: `profile:${profileId}` },
    ]);
  }

  async canViewProfile(userId, profileId) {
    return this.checkPermission(userId, "can_view", `profile:${profileId}`);
  }

  async canEditProfile(userId, profileId) {
    return this.checkPermission(userId, "can_edit", `profile:${profileId}`);
  }

  // ==================== TRAVEL PLAN ====================

  async createTravelPlanRelations(userId, planId) {
    const client = await this.ensureInitialized();
    return client.writeTuples([
      { user: `user:${userId}`, relation: "owner", object: `travelplan:${planId}` },
    ]);
  }

  async shareTravelPlan(planId, userId, permission) {
    // permission: viewer | editor | suggester
    const client = await this.ensureInitialized();
    return client.writeTuples([
      { user: `user:${userId}`, relation: permission, object: `travelplan:${planId}` },
    ]);
  }

  async revokeTravelPlanAccess(planId, userId, permission) {
    const client = await this.ensureInitialized();
    return client.deleteTuples([
      { user: `user:${userId}`, relation: permission, object: `travelplan:${planId}` },
    ]);
  }

  async grantTravelPlanSuperadminAccess(planId, adminId) {
    const client = await this.ensureInitialized();
    return client.writeTuples([
      { user: `user:${adminId}`, relation: "superadmin_access", object: `travelplan:${planId}` },
    ]);
  }

  async canViewTravelPlan(userId, planId) {
    return this.checkPermission(userId, "can_view", `travelplan:${planId}`);
  }

  async canEditTravelPlan(userId, planId) {
    return this.checkPermission(userId, "can_edit", `travelplan:${planId}`);
  }

  async canSuggestTravelPlan(userId, planId) {
    return this.checkPermission(userId, "can_suggest", `travelplan:${planId}`);
  }

  async canDeleteTravelPlan(userId, planId) {
    return this.checkPermission(userId, "can_delete", `travelplan:${planId}`);
  }

  async canShareTravelPlan(userId, planId) {
    return this.checkPermission(userId, "can_share", `travelplan:${planId}`);
  }

  async canAddBookingToTravelPlan(userId, planId) {
    return this.checkPermission(userId, "can_add_booking", `travelplan:${planId}`);
  }

  async canManageTravelPlanCollaborators(userId, planId) {
    return this.checkPermission(userId, "can_manage_collaborators", `travelplan:${planId}`);
  }

  // ==================== ACCOMMODATION ====================

  async createAccommodationRelations(userId, accommodationId) {
    const client = await this.ensureInitialized();
    return client.writeTuples([
      { user: `user:${userId}`, relation: "owner", object: `accommodation:${accommodationId}` },
    ]);
  }

  async addAccommodationManager(accommodationId, managerId) {
    const client = await this.ensureInitialized();
    return client.writeTuples([
      { user: `user:${managerId}`, relation: "manager", object: `accommodation:${accommodationId}` },
    ]);
  }

  async addAccommodationEditor(accommodationId, editorId) {
    const client = await this.ensureInitialized();
    return client.writeTuples([
      { user: `user:${editorId}`, relation: "editor", object: `accommodation:${accommodationId}` },
    ]);
  }

  async addAccommodationViewer(accommodationId, viewerId) {
    const client = await this.ensureInitialized();
    return client.writeTuples([
      { user: `user:${viewerId}`, relation: "viewer", object: `accommodation:${accommodationId}` },
    ]);
  }

  async removeAccommodationUser(accommodationId, userId, relation) {
    const client = await this.ensureInitialized();
    return client.deleteTuples([
      { user: `user:${userId}`, relation, object: `accommodation:${accommodationId}` },
    ]);
  }

  async canViewAccommodation(userId, id) {
    return this.checkPermission(userId, "can_view", `accommodation:${id}`);
  }

  async canEditAccommodation(userId, id) {
    return this.checkPermission(userId, "can_edit", `accommodation:${id}`);
  }

  async canManageAccommodationRooms(userId, id) {
    return this.checkPermission(userId, "can_manage_rooms", `accommodation:${id}`);
  }

  async canManageAccommodationServices(userId, id) {
    return this.checkPermission(userId, "can_manage_services", `accommodation:${id}`);
  }

  async canUpdateAccommodationAvailability(userId, id) {
    return this.checkPermission(userId, "can_update_availability", `accommodation:${id}`);
  }

  async canPublishAccommodation(userId, id) {
    return this.checkPermission(userId, "can_publish", `accommodation:${id}`);
  }

  async canDeleteAccommodation(userId, id) {
    return this.checkPermission(userId, "can_delete", `accommodation:${id}`);
  }

  // ==================== ACCOMMODATION ROOM ====================

  async createRoomRelations(ownerId, roomId, accommodationId) {
    const client = await this.ensureInitialized();
    return client.writeTuples([
      { user: `user:${ownerId}`, relation: "owner", object: `accommodation_room:${roomId}` },
      { user: `accommodation:${accommodationId}`, relation: "parent_accommodation", object: `accommodation_room:${roomId}` },
    ]);
  }

  async canViewRoom(userId, roomId) {
    return this.checkPermission(userId, "can_view", `accommodation_room:${roomId}`);
  }

  async canEditRoom(userId, roomId) {
    return this.checkPermission(userId, "can_edit", `accommodation_room:${roomId}`);
  }

  async canDeleteRoom(userId, roomId) {
    return this.checkPermission(userId, "can_delete", `accommodation_room:${roomId}`);
  }

  // ==================== ACCOMMODATION SERVICE ====================

  async createServiceRelations(ownerId, serviceId, accommodationId) {
    const client = await this.ensureInitialized();
    return client.writeTuples([
      { user: `user:${ownerId}`, relation: "owner", object: `accommodation_service:${serviceId}` },
      { user: `accommodation:${accommodationId}`, relation: "parent_accommodation", object: `accommodation_service:${serviceId}` },
    ]);
  }

  async canViewService(userId, serviceId) {
    return this.checkPermission(userId, "can_view", `accommodation_service:${serviceId}`);
  }

  async canEditService(userId, serviceId) {
    return this.checkPermission(userId, "can_edit", `accommodation_service:${serviceId}`);
  }

  async canDeleteService(userId, serviceId) {
    return this.checkPermission(userId, "can_delete", `accommodation_service:${serviceId}`);
  }

  // ==================== ACCOMMODATION BOOKING ====================

  async createAccommodationBookingRelations(userId, bookingId, planId) {
    const client = await this.ensureInitialized();
    return client.writeTuples([
      { user: `user:${userId}`, relation: "owner", object: `accommodation_booking:${bookingId}` },
      { user: `travelplan:${planId}`, relation: "parent_travelplan", object: `accommodation_booking:${bookingId}` },
    ]);
  }

  async canViewAccommodationBooking(userId, bookingId) {
    return this.checkPermission(userId, "can_view", `accommodation_booking:${bookingId}`);
  }

  async canEditAccommodationBooking(userId, bookingId) {
    return this.checkPermission(userId, "can_edit", `accommodation_booking:${bookingId}`);
  }

  async canCancelAccommodationBooking(userId, bookingId) {
    return this.checkPermission(userId, "can_cancel", `accommodation_booking:${bookingId}`);
  }

  // ==================== TRANSPORTATION PROVIDER ====================

  async createTransportationProviderRelations(userId, providerId) {
    const client = await this.ensureInitialized();
    return client.writeTuples([
      { user: `user:${userId}`, relation: "owner", object: `transportation_provider:${providerId}` },
    ]);
  }

  async addTransportationProviderManager(providerId, managerId) {
    const client = await this.ensureInitialized();
    return client.writeTuples([
      { user: `user:${managerId}`, relation: "manager", object: `transportation_provider:${providerId}` },
    ]);
  }

  async addTransportationProviderEditor(providerId, editorId) {
    const client = await this.ensureInitialized();
    return client.writeTuples([
      { user: `user:${editorId}`, relation: "editor", object: `transportation_provider:${providerId}` },
    ]);
  }

  async addTransportationProviderViewer(providerId, viewerId) {
    const client = await this.ensureInitialized();
    return client.writeTuples([
      { user: `user:${viewerId}`, relation: "viewer", object: `transportation_provider:${providerId}` },
    ]);
  }

  async canViewTransportationProvider(userId, id) {
    return this.checkPermission(userId, "can_view", `transportation_provider:${id}`);
  }

  async canEditTransportationProvider(userId, id) {
    return this.checkPermission(userId, "can_edit", `transportation_provider:${id}`);
  }

  async canManageProviderVehicles(userId, id) {
    return this.checkPermission(userId, "can_manage_vehicles", `transportation_provider:${id}`);
  }

  async canUpdateProviderAvailability(userId, id) {
    return this.checkPermission(userId, "can_update_availability", `transportation_provider:${id}`);
  }

  async canPublishTransportationProvider(userId, id) {
    return this.checkPermission(userId, "can_publish", `transportation_provider:${id}`);
  }

  async canDeleteTransportationProvider(userId, id) {
    return this.checkPermission(userId, "can_delete", `transportation_provider:${id}`);
  }

  // ==================== TRANSPORTATION VEHICLE ====================

  async createTransportationVehicleRelations(ownerId, vehicleId, providerId) {
    const client = await this.ensureInitialized();
    return client.writeTuples([
      { user: `user:${ownerId}`, relation: "owner", object: `transportation_vehicle:${vehicleId}` },
      { user: `transportation_provider:${providerId}`, relation: "parent_provider", object: `transportation_vehicle:${vehicleId}` },
    ]);
  }

  async canViewTransportationVehicle(userId, vehicleId) {
    return this.checkPermission(userId, "can_view", `transportation_vehicle:${vehicleId}`);
  }

  async canEditTransportationVehicle(userId, vehicleId) {
    return this.checkPermission(userId, "can_edit", `transportation_vehicle:${vehicleId}`);
  }

  async canDeleteTransportationVehicle(userId, vehicleId) {
    return this.checkPermission(userId, "can_delete", `transportation_vehicle:${vehicleId}`);
  }

  // ==================== TRANSPORTATION BOOKING ====================

  async createTransportationBookingRelations(userId, bookingId, planId) {
    const client = await this.ensureInitialized();
    return client.writeTuples([
      { user: `user:${userId}`, relation: "owner", object: `transportation_booking:${bookingId}` },
      { user: `travelplan:${planId}`, relation: "parent_travelplan", object: `transportation_booking:${bookingId}` },
    ]);
  }

  async canViewTransportationBooking(userId, bookingId) {
    return this.checkPermission(userId, "can_view", `transportation_booking:${bookingId}`);
  }

  async canEditTransportationBooking(userId, bookingId) {
    return this.checkPermission(userId, "can_edit", `transportation_booking:${bookingId}`);
  }

  async canCancelTransportationBooking(userId, bookingId) {
    return this.checkPermission(userId, "can_cancel", `transportation_booking:${bookingId}`);
  }

  // ==================== TRAVEL PACKAGE ====================

  async createTravelPackageRelations(userId, packageId) {
    const client = await this.ensureInitialized();
    return client.writeTuples([
      { user: `user:${userId}`, relation: "owner", object: `travel_package:${packageId}` },
    ]);
  }

  async addTravelPackageManager(packageId, managerId) {
    const client = await this.ensureInitialized();
    return client.writeTuples([
      { user: `user:${managerId}`, relation: "manager", object: `travel_package:${packageId}` },
    ]);
  }

  async canViewTravelPackage(userId, id) {
    return this.checkPermission(userId, "can_view", `travel_package:${id}`);
  }

  async canEditTravelPackage(userId, id) {
    return this.checkPermission(userId, "can_edit", `travel_package:${id}`);
  }

  async canUpdateTravelPackageAvailability(userId, id) {
    return this.checkPermission(userId, "can_update_availability", `travel_package:${id}`);
  }

  async canPublishTravelPackage(userId, id) {
    return this.checkPermission(userId, "can_publish", `travel_package:${id}`);
  }

  async canDeleteTravelPackage(userId, id) {
    return this.checkPermission(userId, "can_delete", `travel_package:${id}`);
  }

  // ==================== TRAVEL PACKAGE BOOKING ====================

  async createTravelPackageBookingRelations(userId, bookingId, planId, packageId) {
    const client = await this.ensureInitialized();
    return client.writeTuples([
      { user: `user:${userId}`, relation: "owner", object: `travel_package_booking:${bookingId}` },
      { user: `travelplan:${planId}`, relation: "parent_travelplan", object: `travel_package_booking:${bookingId}` },
      { user: `travel_package:${packageId}`, relation: "parent_package", object: `travel_package_booking:${bookingId}` },
    ]);
  }

  async canViewTravelPackageBooking(userId, bookingId) {
    return this.checkPermission(userId, "can_view", `travel_package_booking:${bookingId}`);
  }

  async canEditTravelPackageBooking(userId, bookingId) {
    return this.checkPermission(userId, "can_edit", `travel_package_booking:${bookingId}`);
  }

  async canCancelTravelPackageBooking(userId, bookingId) {
    return this.checkPermission(userId, "can_cancel", `travel_package_booking:${bookingId}`);
  }

  // ==================== VENDOR EXPERIENCE ====================

  async createVendorExperienceRelations(userId, experienceId) {
    const client = await this.ensureInitialized();
    return client.writeTuples([
      { user: `user:${userId}`, relation: "owner", object: `vendor_experience:${experienceId}` },
    ]);
  }

  async addVendorExperienceManager(experienceId, managerId) {
    const client = await this.ensureInitialized();
    return client.writeTuples([
      { user: `user:${managerId}`, relation: "manager", object: `vendor_experience:${experienceId}` },
    ]);
  }

  async canViewVendorExperience(userId, id) {
    return this.checkPermission(userId, "can_view", `vendor_experience:${id}`);
  }

  async canEditVendorExperience(userId, id) {
    return this.checkPermission(userId, "can_edit", `vendor_experience:${id}`);
  }

  async canUpdateVendorExperienceAvailability(userId, id) {
    return this.checkPermission(userId, "can_update_availability", `vendor_experience:${id}`);
  }

  async canPublishVendorExperience(userId, id) {
    return this.checkPermission(userId, "can_publish", `vendor_experience:${id}`);
  }

  async canDeleteVendorExperience(userId, id) {
    return this.checkPermission(userId, "can_delete", `vendor_experience:${id}`);
  }

  // ==================== EXPERIENCE BOOKING ====================

  async createExperienceBookingRelations(userId, bookingId, planId, experienceId) {
    const client = await this.ensureInitialized();
    return client.writeTuples([
      { user: `user:${userId}`, relation: "owner", object: `experience_booking:${bookingId}` },
      { user: `travelplan:${planId}`, relation: "parent_travelplan", object: `experience_booking:${bookingId}` },
      { user: `vendor_experience:${experienceId}`, relation: "parent_experience", object: `experience_booking:${bookingId}` },
    ]);
  }

  async canViewExperienceBooking(userId, bookingId) {
    return this.checkPermission(userId, "can_view", `experience_booking:${bookingId}`);
  }

  async canEditExperienceBooking(userId, bookingId) {
    return this.checkPermission(userId, "can_edit", `experience_booking:${bookingId}`);
  }

  async canCancelExperienceBooking(userId, bookingId) {
    return this.checkPermission(userId, "can_cancel", `experience_booking:${bookingId}`);
  }

  // ==================== RETAIL STORE ====================

  async createRetailStoreRelations(userId, storeId) {
    const client = await this.ensureInitialized();
    return client.writeTuples([
      { user: `user:${userId}`, relation: "owner", object: `retail_store:${storeId}` },
    ]);
  }

  async addRetailStoreManager(storeId, managerId) {
    const client = await this.ensureInitialized();
    return client.writeTuples([
      { user: `user:${managerId}`, relation: "manager", object: `retail_store:${storeId}` },
    ]);
  }

  async canViewRetailStore(userId, storeId) {
    return this.checkPermission(userId, "can_view", `retail_store:${storeId}`);
  }

  async canEditRetailStore(userId, storeId) {
    return this.checkPermission(userId, "can_edit", `retail_store:${storeId}`);
  }

  async canManageStoreProducts(userId, storeId) {
    return this.checkPermission(userId, "can_manage_products", `retail_store:${storeId}`);
  }

  async canUpdateStoreInventory(userId, storeId) {
    return this.checkPermission(userId, "can_update_inventory", `retail_store:${storeId}`);
  }

  async canPublishRetailStore(userId, storeId) {
    return this.checkPermission(userId, "can_publish", `retail_store:${storeId}`);
  }

  async canDeleteRetailStore(userId, storeId) {
    return this.checkPermission(userId, "can_delete", `retail_store:${storeId}`);
  }

  // ==================== RETAIL PRODUCT ====================

  async createRetailProductRelations(ownerId, productId, storeId) {
    const client = await this.ensureInitialized();
    return client.writeTuples([
      { user: `user:${ownerId}`, relation: "owner", object: `retail_product:${productId}` },
      { user: `retail_store:${storeId}`, relation: "parent_store", object: `retail_product:${productId}` },
    ]);
  }

  async canViewRetailProduct(userId, productId) {
    return this.checkPermission(userId, "can_view", `retail_product:${productId}`);
  }

  async canEditRetailProduct(userId, productId) {
    return this.checkPermission(userId, "can_edit", `retail_product:${productId}`);
  }

  async canDeleteRetailProduct(userId, productId) {
    return this.checkPermission(userId, "can_delete", `retail_product:${productId}`);
  }

  // ==================== SHOPPING VISIT ====================

  async createShoppingVisitRelations(userId, visitId, planId) {
    const client = await this.ensureInitialized();
    return client.writeTuples([
      { user: `user:${userId}`, relation: "owner", object: `shopping_visit:${visitId}` },
      { user: `travelplan:${planId}`, relation: "parent_travelplan", object: `shopping_visit:${visitId}` },
    ]);
  }

  async canViewShoppingVisit(userId, visitId) {
    return this.checkPermission(userId, "can_view", `shopping_visit:${visitId}`);
  }

  async canEditShoppingVisit(userId, visitId) {
    return this.checkPermission(userId, "can_edit", `shopping_visit:${visitId}`);
  }

  async canCancelShoppingVisit(userId, visitId) {
    return this.checkPermission(userId, "can_cancel", `shopping_visit:${visitId}`);
  }

  // ==================== FINANCIALS ====================

  async createTransactionRelations(userId, transactionId) {
    const client = await this.ensureInitialized();
    return client.writeTuples([
      { user: `user:${userId}`, relation: "owner", object: `transaction:${transactionId}` },
    ]);
  }

  async createPayoutRelations(userId, payoutId) {
    const client = await this.ensureInitialized();
    return client.writeTuples([
      { user: `user:${userId}`, relation: "owner", object: `payout:${payoutId}` },
    ]);
  }

  async canViewTransaction(userId, transactionId) {
    return this.checkPermission(userId, "can_view", `transaction:${transactionId}`);
  }

  async canRefundTransaction(userId, transactionId) {
    return this.checkPermission(userId, "can_refund", `transaction:${transactionId}`);
  }

  async canViewPayout(userId, payoutId) {
    return this.checkPermission(userId, "can_view", `payout:${payoutId}`);
  }

  async canProcessPayout(userId, payoutId) {
    return this.checkPermission(userId, "can_process", `payout:${payoutId}`);
  }

  async canCancelPayout(userId, payoutId) {
    return this.checkPermission(userId, "can_cancel", `payout:${payoutId}`);
  }

  async canRequestPayout(userId, payoutId) {
    return this.checkPermission(userId, "can_request", `payout:${payoutId}`);
  }

  // ==================== VENDOR TEAM MEMBER ====================

  async createTeamMemberRelations(vendorId, userId, role, memberId) {
    // role: is_owner | is_admin | is_manager | is_editor | is_viewer
    const client = await this.ensureInitialized();
    return client.writeTuples([
      { user: `user:${userId}`, relation: role, object: `vendor_team_member:${memberId}` },
      { user: `vendor:${vendorId}`, relation: "vendor", object: `vendor_team_member:${memberId}` },
      { user: `user:${userId}`, relation: "user", object: `vendor_team_member:${memberId}` },
    ]);
  }

  async updateTeamMemberRole(memberId, userId, oldRole, newRole) {
    const client = await this.ensureInitialized();
    await client.deleteTuples([
      { user: `user:${userId}`, relation: oldRole, object: `vendor_team_member:${memberId}` },
    ]);
    return client.writeTuples([
      { user: `user:${userId}`, relation: newRole, object: `vendor_team_member:${memberId}` },
    ]);
  }

  async removeTeamMember(memberId, userId, role, vendorId) {
    const client = await this.ensureInitialized();
    return client.deleteTuples([
      { user: `user:${userId}`, relation: role, object: `vendor_team_member:${memberId}` },
      { user: `vendor:${vendorId}`, relation: "vendor", object: `vendor_team_member:${memberId}` },
      { user: `user:${userId}`, relation: "user", object: `vendor_team_member:${memberId}` },
    ]);
  }

  async canManageTeam(userId, memberId) {
    return this.checkPermission(userId, "can_manage_team", `vendor_team_member:${memberId}`);
  }

  async canManageListings(userId, memberId) {
    return this.checkPermission(userId, "can_manage_listings", `vendor_team_member:${memberId}`);
  }

  async canEditListings(userId, memberId) {
    return this.checkPermission(userId, "can_edit_listings", `vendor_team_member:${memberId}`);
  }

  async canViewListings(userId, memberId) {
    return this.checkPermission(userId, "can_view_listings", `vendor_team_member:${memberId}`);
  }

  async canViewTeamAnalytics(userId, memberId) {
    return this.checkPermission(userId, "can_view_analytics", `vendor_team_member:${memberId}`);
  }

  async canViewTeamFinancials(userId, memberId) {
    return this.checkPermission(userId, "can_view_financials", `vendor_team_member:${memberId}`);
  }

  // ==================== VENDOR REVIEW ====================

  async createVendorReviewRelations(userId, reviewId, vendorId) {
    const client = await this.ensureInitialized();
    return client.writeTuples([
      { user: `user:${userId}`, relation: "author", object: `vendor_review:${reviewId}` },
      { user: `vendor:${vendorId}`, relation: "vendor", object: `vendor_review:${reviewId}` },
    ]);
  }

  async flagVendorReview(userId, reviewId) {
    const client = await this.ensureInitialized();
    return client.writeTuples([
      { user: `user:${userId}`, relation: "can_flag", object: `vendor_review:${reviewId}` },
    ]);
  }

  async canViewReview(userId, reviewId) {
    return this.checkPermission(userId, "can_view", `vendor_review:${reviewId}`);
  }

  async canEditReview(userId, reviewId) {
    return this.checkPermission(userId, "can_edit", `vendor_review:${reviewId}`);
  }

  async canDeleteReview(userId, reviewId) {
    return this.checkPermission(userId, "can_delete", `vendor_review:${reviewId}`);
  }

  async canRespondToReview(userId, reviewId) {
    return this.checkPermission(userId, "can_respond", `vendor_review:${reviewId}`);
  }

  async canHideReview(userId, reviewId) {
    return this.checkPermission(userId, "can_hide", `vendor_review:${reviewId}`);
  }

  // ==================== CORE PERMISSION CHECK ====================

  async checkPermission(userId, relation, object) {
    try {
      const client = await this.ensureInitialized();
      const response = await client.check({ user: `user:${userId}`, relation, object });
      return response.allowed;
    } catch (error) {
      console.error("OpenFGA check error:", error);
      return false;
    }
  }

// =========================================================================
// TRAVEL EXPERIENCE (user‑created custom experience within a travel plan)
// =========================================================================

/**
 * Write owner + parent_travelplan link for a new user‑created travel experience.
 * (The DSL does not yet define a type for travelexperience; you may need to
 *  extend your authorization model accordingly.)
 */
async createTravelExperienceRelations(userId, experienceId, planId) {
  const client = await this.ensureInitialized();
  return client.writeTuples([
    {
      user: `user:${userId}`,
      relation: 'owner',
      object: `travelexperience:${experienceId}`
    },
    {
      user: `travelplan:${planId}`,
      relation: 'parent_travelplan',
      object: `travelexperience:${experienceId}`
    }
  ]);
}

async canEditTravelExperience(userId, experienceId) {
  return this.checkPermission(userId, 'can_edit', `travelexperience:${experienceId}`);
}

async canDeleteTravelExperience(userId, experienceId) {
  return this.checkPermission(userId, 'can_delete', `travelexperience:${experienceId}`);
}

  // ==================== UTILITY ====================

  async listAccessibleObjects(userId, relation, type) {
    try {
      const client = await this.ensureInitialized();
      const response = await client.listObjects({ user: `user:${userId}`, relation, type });
      return response.objects;
    } catch (error) {
      console.error("OpenFGA listObjects error:", error);
      return [];
    }
  }

  async listAccessibleTravelPlans(userId, relation = "can_view") {
    return this.listAccessibleObjects(userId, relation, "travelplan");
  }

  async listAccessibleAccommodations(userId, relation = "can_view") {
    return this.listAccessibleObjects(userId, relation, "accommodation");
  }

  async listAccessibleTransportationProviders(userId, relation = "can_view") {
    return this.listAccessibleObjects(userId, relation, "transportation_provider");
  }

  async listAccessibleTravelPackages(userId, relation = "can_view") {
    return this.listAccessibleObjects(userId, relation, "travel_package");
  }

  async listAccessibleVendorExperiences(userId, relation = "can_view") {
    return this.listAccessibleObjects(userId, relation, "vendor_experience");
  }

  async listAccessibleRetailStores(userId, relation = "can_view") {
    return this.listAccessibleObjects(userId, relation, "retail_store");
  }

  async batchCheckPermissions(checks) {
    try {
      const client = await this.ensureInitialized();
      const results = await client.batchCheck(
        checks.map(({ userId, relation, object }) => ({
          user: `user:${userId}`,
          relation,
          object,
        }))
      );
      return results;
    } catch (error) {
      console.error("OpenFGA batchCheck error:", error);
      return checks.map(() => ({ allowed: false }));
    }
  }

  async readTuples(query) {
    const client = await this.ensureInitialized();
    return client.read(query);
  }

  async getStoreInfo() {
    return { storeId: this.storeId, modelId: this.modelId, initialized: this.initialized };
  }

  isInitialized() {
    return this.initialized;
  }
}

module.exports = new OpenFGAService();