export type MemberStatus      = 'pending' | 'active' | 'suspended' | 'removed'
export type GroupStatus       = 'open' | 'full' | 'active' | 'completed'
export type MembershipStatus  = 'active' | 'defaulted' | 'completed'
export type ContributionFreq  = 'daily' | 'weekly' | 'monthly'
export type ContributionStatus = 'pending' | 'paid' | 'overdue'
export type PayoutStatus      = 'upcoming' | 'processing' | 'paid'
export type KYCStatus         = 'pending' | 'approved' | 'rejected'
export type TxType            = 'registration_fee' | 'contribution' | 'payout'
export type TxStatus          = 'pending' | 'success' | 'failed'

export interface Member {
  id:                    string
  member_id:             string
  full_name:             string
  phone:                 string
  email?:                string
  whatsapp_number?:      string
  status:                MemberStatus
  occupation?:           string
  residential_address?:  string
  mobile_money_number?:  string
  mobile_money_provider?: string
  bank_name?:            string
  bank_account_number?:  string
  bank_account_name?:    string
  created_at:            string
}

export interface SusuGroup {
  id:                     string
  name:                   string
  description?:           string
  contribution_amount:    number
  contribution_frequency: ContributionFreq
  cycle_days:             number
  max_members:            number
  current_members:        number
  registration_fee:       number
  status:                 GroupStatus
  start_date?:            string
  end_date?:              string
  rules?:                 string
  image_url?:             string
  created_at:             string
}

export interface GroupMembership {
  id:              string
  member_id:       string
  group_id:        string
  payout_position: number
  payout_date?:    string
  payout_amount?:  number
  payout_received: boolean
  status:          MembershipStatus
  joined_at:       string
  susu_groups?:    SusuGroup
}

export interface Contribution {
  id:          string
  member_id:   string
  group_id:    string
  amount:      number
  due_date:    string
  paid_at?:    string
  status:      ContributionStatus
  paystack_ref?: string
  cycle_number: number
  susu_groups?: { name: string }
}

export interface Payout {
  id:             string
  member_id:      string
  group_id:       string
  total_amount:   number
  scheduled_date: string
  paid_at?:       string
  status:         PayoutStatus
  notes?:         string
  susu_groups?:   { name: string }
  members?:       Partial<Member>
}

export interface KYCApplication {
  id:                    string
  full_name:             string
  phone:                 string
  email?:                string
  ghana_card_number:     string
  selected_group_id:     string
  registration_fee_paid: boolean
  status:                KYCStatus
  rejection_reason?:     string
  submitted_at:          string
  reviewed_at?:          string
  susu_groups?:          { name: string }
}

export interface Transaction {
  id:          string
  member_id?:  string
  type:        TxType
  amount:      number
  reference:   string
  description?: string
  status:      TxStatus
  created_at:  string
  members?:    Partial<Member>
}

export interface Announcement {
  id:         string
  title:      string
  content:    string
  is_global:  boolean
  created_at: string
  susu_groups?: { name: string }
}

export interface MemberDashboard {
  member:               Member
  memberships:          GroupMembership[]
  pendingContributions: Contribution[]
  recentPayments:       Contribution[]
  payouts:              Payout[]
  announcements:        Announcement[]
  summary: {
    totalPaid:        number
    totalPending:     number
    nextPayoutDate?:  string
    nextPayoutAmount?: number
    activeGroups:     number
  }
}

export interface AdminDashboard {
  stats: {
    totalMembers:         number
    activeGroups:         number
    pendingKYC:           number
    overdueContributions: number
    totalCollected:       number
  }
  recentKYC:         KYCApplication[]
  recentTransactions: Transaction[]
  upcomingPayouts:   Payout[]
  groups:            SusuGroup[]
}
