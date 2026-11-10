# Course Purchases and Refunds

How learners pay for courses and how they get their money back.

## Language

### Buying

**Learner**:
A person who buys and takes courses.
_Avoid_: Customer, student, subscriber

**Purchase**:
A learner's one-off payment for a single course.
_Avoid_: Subscription, order, transaction

**Amount Paid**:
What the learner was actually charged for a Purchase. It can be less than the course's list price.
_Avoid_: Price (when you mean the amount charged)

**Purchasing-Power Price**:
A course price lowered for the learner's country.
_Avoid_: PPP discount (in prose), regional price

**Admin**:
A person who runs the platform. Only Admins approve or decline Refund Requests; a course's own instructor cannot.
_Avoid_: Staff (in code, "staff" also covers a course's instructor)

**Team Seat**:
A Purchase made as part of a team licence, handed to a learner through a coupon. Once claimed, it belongs to the team, not to the learner.
_Avoid_: Licence (when you mean one seat)

**Enrollment**:
A learner's current access to a course. A Purchase or a claimed Team Seat creates it; a Refund ends it. The learner's progress is not part of the Enrollment and outlives it.
_Avoid_: Purchase (when you mean access), subscription

### Getting money back

**Refund Request**:
A learner's ask, with a reason, to get back what they paid for a Purchase.
_Avoid_: Cancellation, Reversal, Chargeback, cancel my purchase, cancel my subscription

**Refund**:
The money owed back to the learner once an Admin approves a Refund Request. A refunded Purchase no longer gives the learner the course.
_Avoid_: Reversal, Chargeback, cancellation

**Refund Amount**:
How much a Refund returns. It is always the Amount Paid.
_Avoid_: Refundable amount (when computed from the list price)

**Refund Window**:
The 14 calendar days from the day of the Purchase, including the last day, during which a learner can make a Refund Request.
_Avoid_: Cancel window, cancellation period

**Refund Eligibility**:
Whether a Purchase can still have a Refund Request made against it. It requires all of the following: the Refund Window is open, the learner has watched less than 2 hours, the learner has completed less than half of the lessons, the Purchase is not a claimed Team Seat, no Refund Request on it is still Open, and none on it has been Approved. A Declined Refund Request does not stop the learner asking again.
_Avoid_: Cancellation offer, cancellable

### Refund Request states

**Open**:
A Refund Request that an Admin has not yet approved or declined. Refund Eligibility is checked only when the learner asks, not again when an Admin decides.
_Avoid_: Pending, Requested, Awaiting review, Pending Chargeback

**Approved**:
A Refund Request that an Admin accepted, so a Refund is owed. Final: it can never become Open or Declined.

**Declined**:
A Refund Request that an Admin rejected, giving the learner a reason. No money is returned. Final: it can never become Open or Approved.
_Avoid_: Rejected, denied

### Not the same thing

**Chargeback**:
A payment dispute that the cardholder raises with their bank, bypassing us entirely. It is never a Refund Request, and this product does not model it today.
_Avoid_: using it for a Refund Request in any state
