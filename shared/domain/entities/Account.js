/**
 * Account Entity
 *
 * Represents an Instagram account used for outreach.
 * Multiple accounts can be managed for different profiles/niches.
 */

/**
 * Account Entity Class
 */
export class Account {
  constructor(data = {}) {
    this.id = data.id || null;
    this.name = data.name || '';
    this.igUsername = data.ig_username || data.igUsername || null;
    this.description = data.description || null;
    this.isDefault = Boolean(data.is_default || data.isDefault);
    this.createdAt = data.created_at || data.createdAt || null;
  }

  /**
   * Check if account is valid
   */
  isValid() {
    return this.name && this.name.length > 0;
  }

  /**
   * Check if this is the default account
   */
  isDefaultAccount() {
    return this.isDefault;
  }

  /**
   * Set as default account
   */
  setAsDefault() {
    this.isDefault = true;
    return this;
  }

  /**
   * Remove default status
   */
  removeDefault() {
    this.isDefault = false;
    return this;
  }

  /**
   * Get display name
   */
  getDisplayName() {
    if (this.igUsername) {
      return `@${this.igUsername} (${this.name})`;
    }
    return this.name;
  }

  /**
   * Convert to database row format
   */
  toDbRow() {
    return {
      id: this.id,
      name: this.name,
      ig_username: this.igUsername,
      description: this.description,
      is_default: this.isDefault ? 1 : 0,
      created_at: this.createdAt
    };
  }

  /**
   * Convert to plain object
   */
  toJSON() {
    return {
      id: this.id,
      name: this.name,
      igUsername: this.igUsername,
      description: this.description,
      isDefault: this.isDefault,
      createdAt: this.createdAt
    };
  }

  /**
   * Create Account from database row
   */
  static fromDbRow(row) {
    if (!row) return null;
    return new Account(row);
  }

  /**
   * Create new Account
   */
  static create(name, igUsername = null, description = null) {
    return new Account({
      name,
      ig_username: igUsername,
      description,
      is_default: false
    });
  }
}

export default Account;
