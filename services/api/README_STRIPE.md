# Stripe Integration Setup Guide

This guide explains how to set up and use the Stripe integration in the Dreamify Analytics Platform.

## Backend Setup

### 1. Install Dependencies

```bash
cd dreamify-backend
pip install -r requirements.txt
```

### 2. Environment Configuration

Copy the environment example and configure Stripe keys:

```bash
cp env.example .env
```

Edit `.env` and add your Stripe keys:

```env
# Stripe Configuration
STRIPE_PUBLISHABLE_KEY=pk_test_your_publishable_key_here
STRIPE_SECRET_KEY=sk_test_your_secret_key_here
STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret_here
```

### 3. Create Stripe Products and Prices

Before using the integration, you need to create products and prices in your Stripe dashboard:

1. Go to [Stripe Dashboard](https://dashboard.stripe.com)
2. Navigate to Products
3. Create a product for "Pro Plan" with a monthly price of $25
4. Note the price ID (starts with `price_`)

### 4. Configure Webhooks

Set up webhooks in your Stripe dashboard:

1. Go to Webhooks in Stripe Dashboard
2. Add endpoint: `https://yourdomain.com/api/v1/stripe/webhooks`
3. Select events:
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`
4. Copy the webhook secret to your `.env` file

## Frontend Setup

### 1. Install Dependencies

```bash
cd dreamify-frontend/frontend
npm install
```

### 2. Environment Configuration

Create a `.env` file in the frontend directory:

```env
VITE_STRIPE_PUBLISHABLE_KEY=pk_test_your_publishable_key_here
VITE_API_BASE_URL=http://localhost:5000/api/v1
```

### 3. Update Price IDs

Update the price IDs in the frontend components to match your Stripe products.

## API Endpoints

The integration provides the following API endpoints:

### Products
- `GET /api/v1/stripe/products` - Get available subscription plans

### Customers
- `POST /api/v1/stripe/customers` - Create a new customer

### Checkout
- `POST /api/v1/stripe/checkout/sessions` - Create checkout session

### Subscriptions
- `POST /api/v1/stripe/subscriptions` - Create subscription
- `GET /api/v1/stripe/subscriptions/{id}` - Get subscription details
- `POST /api/v1/stripe/subscriptions/{id}/cancel` - Cancel subscription

### Customer Portal
- `POST /api/v1/stripe/customer-portal` - Create portal session

### Credits
- `GET /api/v1/stripe/credits/usage` - Get credit usage
- `POST /api/v1/stripe/credits/consume` - Consume credits

### Webhooks
- `POST /api/v1/stripe/webhooks` - Handle Stripe webhooks

## Usage Examples

### Creating a Checkout Session

```javascript
const response = await fetch('/api/v1/stripe/checkout/sessions', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    price_id: 'price_1234567890',
    user_id: 'user_123',
    success_url: 'https://yourapp.com/success',
    cancel_url: 'https://yourapp.com/cancel',
  }),
});
```

### Consuming Credits

```javascript
const response = await fetch('/api/v1/stripe/credits/consume', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    user_id: 'user_123',
    action: 'create_dashboard',
    credits_required: 1,
  }),
});
```

## React Components

### StripeProvider

Wrap your app with the StripeProvider:

```tsx
import { StripeProvider } from '@/contexts/StripeContext';

function App() {
  return (
    <StripeProvider>
      {/* Your app components */}
    </StripeProvider>
  );
}
```

### useSubscription Hook

Use the subscription hook in your components:

```tsx
import { useSubscription } from '@/hooks/useSubscription';

function MyComponent() {
  const { subscription, creditUsage, upgradeToPro } = useSubscription();
  
  return (
    <div>
      {subscription && (
        <p>Current plan: {subscription.tier}</p>
      )}
      {creditUsage && (
        <p>Credits used: {creditUsage.daily_credits_used}/{creditUsage.daily_credits_limit}</p>
      )}
      <button onClick={upgradeToPro}>Upgrade to Pro</button>
    </div>
  );
}
```

## Testing

### Test Mode

The integration is configured for Stripe test mode by default. Use test card numbers:

- Success: `4242 4242 4242 4242`
- Decline: `4000 0000 0000 0002`

### Webhook Testing

Use Stripe CLI for local webhook testing:

```bash
stripe listen --forward-to localhost:5000/api/v1/stripe/webhooks
```

## Production Deployment

### 1. Update Environment Variables

Replace test keys with live keys in production:

```env
STRIPE_PUBLISHABLE_KEY=pk_live_your_live_publishable_key
STRIPE_SECRET_KEY=sk_live_your_live_secret_key
STRIPE_WEBHOOK_SECRET=whsec_your_live_webhook_secret
```

### 2. Update Webhook Endpoints

Update webhook endpoints to your production domain.

### 3. Test Live Mode

Test with real payment methods in a controlled environment before going live.

## Security Considerations

1. **Never expose secret keys** in frontend code
2. **Verify webhook signatures** to ensure requests are from Stripe
3. **Use HTTPS** in production
4. **Implement rate limiting** for API endpoints
5. **Log all payment events** for audit trails

## Troubleshooting

### Common Issues

1. **Webhook signature verification fails**
   - Check that webhook secret is correct
   - Ensure raw request body is used for verification

2. **Checkout session creation fails**
   - Verify price IDs exist in Stripe
   - Check that customer exists or is created properly

3. **Credit consumption fails**
   - Ensure user has sufficient credits
   - Check subscription status is active

### Debug Mode

Enable debug logging by setting:

```env
LOG_LEVEL=DEBUG
```

This will provide detailed logs for troubleshooting Stripe operations.
