import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import axios from 'axios';

admin.initializeApp();
const db = admin.firestore();

// ========================================
// 1. WEBHOOK MERCADO PAGO
// ========================================
export const onMercadoPagoWebhook = functions.https.onRequest(async (req, res) => {
  console.log('🔔 Webhook recebido:', req.body);

  try {
    // Validar método
    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }

    // Extrair dados do webhook
    const { type, data } = req.body;

    // Processar apenas eventos de pagamento
    if (type === 'payment' || req.body.action === 'payment.created' || req.body.action === 'payment.updated') {
      const paymentId = data?.id || req.body.data?.id;

      if (!paymentId) {
        console.error('❌ Payment ID não encontrado');
        res.status(400).send('Payment ID missing');
        return;
      }

      // Buscar detalhes do pagamento no Mercado Pago
      const config = functions.config();
      const accessToken = config.mercadopago.access_token;

      const response = await axios.get(
        `https://api.mercadopago.com/v1/payments/${paymentId}`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
          },
        }
      );

      const payment = response.data;
      console.log('💳 Pagamento:', payment);

      // Verificar se foi aprovado
      if (payment.status === 'approved') {
        // Extrair metadata (userId, packageId, etc)
        const userId = payment.metadata?.user_id || payment.external_reference;
        const packageId = payment.metadata?.package_id;
        const credits = payment.metadata?.credits;

        if (!userId) {
          console.error('❌ User ID não encontrado no pagamento');
          res.status(400).send('User ID missing');
          return;
        }

        // Adicionar créditos ao usuário
        const userRef = db.collection('users').doc(userId);
        const walletRef = userRef.collection('wallet').doc('current');

        await db.runTransaction(async (transaction) => {
          const walletDoc = await transaction.get(walletRef);
          
          const currentPaidCredits = walletDoc.exists ? (walletDoc.data()?.paid_credits || 0) : 0;
          const newPaidCredits = currentPaidCredits + parseInt(credits);

          // Atualizar wallet
          transaction.set(walletRef, {
            paid_credits: newPaidCredits,
            last_purchase_at: admin.firestore.FieldValue.serverTimestamp(),
            updated_at: admin.firestore.FieldValue.serverTimestamp(),
          }, { merge: true });

          // Registrar transação
          const transactionRef = userRef.collection('credit_transactions').doc();
          transaction.set(transactionRef, {
            type: 'purchase',
            amount: parseInt(credits),
            credit_type: 'paid',
            payment_id: paymentId,
            package_id: packageId || null,
            status: 'completed',
            created_at: admin.firestore.FieldValue.serverTimestamp(),
          });

          // Registrar compra
          const purchaseRef = userRef.collection('purchases').doc(paymentId);
          transaction.set(purchaseRef, {
            payment_id: paymentId,
            package_id: packageId || null,
            credits: parseInt(credits),
            amount_paid: payment.transaction_amount,
            currency: payment.currency_id,
            status: 'completed',
            payment_method: payment.payment_method_id,
            created_at: admin.firestore.FieldValue.serverTimestamp(),
          });
        });

        console.log(`✅ ${credits} créditos adicionados ao usuário ${userId}`);

        // Processar bônus de indicação (se houver)
        await processReferralBonus(userId, parseInt(credits));

        res.status(200).send('OK');
      } else {
        console.log('⏳ Pagamento ainda não aprovado:', payment.status);
        res.status(200).send('Payment not approved yet');
      }
    } else {
      console.log('ℹ️ Evento ignorado:', type);
      res.status(200).send('Event ignored');
    }
  } catch (error) {
    console.error('❌ Erro ao processar webhook:', error);
    res.status(500).send('Internal Server Error');
  }
});

// ========================================
// 2. PROCESSAR BÔNUS DE INDICAÇÃO (MLM)
// ========================================
async function processReferralBonus(userId: string, creditsPurchased: number) {
  try {
    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      console.log('❌ Usuário não encontrado:', userId);
      return;
    }

    const userData = userDoc.data();
    const referrerId = userData?.referral?.referred_by;

    if (!referrerId) {
      console.log('ℹ️ Usuário não foi indicado por ninguém');
      return;
    }

    // Verificar se é a primeira compra (bônus imediato)
    const isFirstPurchase = userData?.referral?.is_first_purchase !== false;

    if (isFirstPurchase) {
      // Bônus imediato: indicador +100, indicado +50
      await db.runTransaction(async (transaction) => {
        // Bônus para o indicador (+100 créditos promocionais)
        const referrerWalletRef = db.collection('users').doc(referrerId).collection('wallet').doc('current');
        const referrerWallet = await transaction.get(referrerWalletRef);
        const referrerPromoCredits = referrerWallet.exists ? (referrerWallet.data()?.promotional_credits || 0) : 0;

        transaction.set(referrerWalletRef, {
          promotional_credits: referrerPromoCredits + 100,
          updated_at: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });

        // Registrar transação do indicador
        const referrerTransactionRef = db.collection('users').doc(referrerId).collection('credit_transactions').doc();
        transaction.set(referrerTransactionRef, {
          type: 'referral_bonus',
          amount: 100,
          credit_type: 'promotional',
          expires_at: admin.firestore.Timestamp.fromMillis(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 dias
          referred_user_id: userId,
          status: 'completed',
          created_at: admin.firestore.FieldValue.serverTimestamp(),
        });

        // Bônus para o indicado (+50 créditos promocionais)
        const userWalletRef = userRef.collection('wallet').doc('current');
        const userWallet = await transaction.get(userWalletRef);
        const userPromoCredits = userWallet.exists ? (userWallet.data()?.promotional_credits || 0) : 0;

        transaction.set(userWalletRef, {
          promotional_credits: userPromoCredits + 50,
          updated_at: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });

        // Registrar transação do indicado
        const userTransactionRef = userRef.collection('credit_transactions').doc();
        transaction.set(userTransactionRef, {
          type: 'welcome_bonus',
          amount: 50,
          credit_type: 'promotional',
          expires_at: admin.firestore.Timestamp.fromMillis(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 dias
          status: 'completed',
          created_at: admin.firestore.FieldValue.serverTimestamp(),
        });

        // Marcar que o usuário já recebeu o bônus de primeira compra
        transaction.update(userRef, {
          'referral.is_first_purchase': false,
        });
      });

      console.log(`✅ Bônus imediato processado: indicador ${referrerId} (+100), indicado ${userId} (+50)`);
    }

    // Bônus recorrente (MLM 3 níveis)
    await processRecurringBonus(referrerId, creditsPurchased, 1); // Nível 1

  } catch (error) {
    console.error('❌ Erro ao processar bônus de indicação:', error);
  }
}

// ========================================
// 3. BÔNUS RECORRENTE (3 NÍVEIS)
// ========================================
async function processRecurringBonus(referrerId: string, creditsPurchased: number, level: number) {
  if (level > 3) return; // Máximo 3 níveis

  const bonusPercentages: { [key: number]: number } = {
    1: 0.05, // 5%
    2: 0.03, // 3%
    3: 0.02, // 2%
  };

  const bonusPercentage = bonusPercentages[level];
  const bonusCredits = Math.floor(creditsPurchased * bonusPercentage);

  if (bonusCredits === 0) return;

  try {
    const referrerRef = db.collection('users').doc(referrerId);
    const referrerDoc = await referrerRef.get();

    if (!referrerDoc.exists) {
      console.log(`❌ Indicador nível ${level} não encontrado:`, referrerId);
      return;
    }

    const referrerData = referrerDoc.data();
    const referrerMLM = referrerData?.mlm || {};
    const activeReferrals = referrerMLM.active_referrals || 0;

    // Calcular teto de créditos
    let maxCredits = 1000; // Padrão: 1-10 ativos
    if (activeReferrals >= 100) maxCredits = 7500;
    else if (activeReferrals >= 51) maxCredits = 5000;
    else if (activeReferrals >= 26) maxCredits = 3500;
    else if (activeReferrals >= 11) maxCredits = 2000;

    // Verificar se já atingiu o teto neste mês
    const currentMonth = new Date().toISOString().slice(0, 7); // "2026-01"
    const monthlyEarned = referrerMLM[`earned_${currentMonth}`] || 0;

    if (monthlyEarned >= maxCredits) {
      console.log(`⚠️ Indicador ${referrerId} (nível ${level}) já atingiu o teto mensal de ${maxCredits} créditos`);
      return;
    }

    // Calcular quanto pode receber
    const availableCredits = maxCredits - monthlyEarned;
    const creditsToGive = Math.min(bonusCredits, availableCredits);

    // Adicionar bônus
    await db.runTransaction(async (transaction) => {
      const walletRef = referrerRef.collection('wallet').doc('current');
      const walletDoc = await transaction.get(walletRef);
      const currentPromoCredits = walletDoc.exists ? (walletDoc.data()?.promotional_credits || 0) : 0;

      transaction.set(walletRef, {
        promotional_credits: currentPromoCredits + creditsToGive,
        updated_at: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });

      // Registrar transação
      const transactionRef = referrerRef.collection('credit_transactions').doc();
      transaction.set(transactionRef, {
        type: `mlm_level_${level}`,
        amount: creditsToGive,
        credit_type: 'promotional',
        expires_at: admin.firestore.Timestamp.fromMillis(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 dias
        level: level,
        status: 'completed',
        created_at: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Atualizar contador mensal
      transaction.update(referrerRef, {
        [`mlm.earned_${currentMonth}`]: admin.firestore.FieldValue.increment(creditsToGive),
      });
    });

    console.log(`✅ Bônus nível ${level} processado: ${creditsToGive} créditos para ${referrerId}`);

    // Processar próximo nível
    const nextReferrerId = referrerData?.referral?.referred_by;
    if (nextReferrerId) {
      await processRecurringBonus(nextReferrerId, creditsPurchased, level + 1);
    }

  } catch (error) {
    console.error(`❌ Erro ao processar bônus nível ${level}:`, error);
  }
}

// ========================================
// 4. CRIAR PREFERÊNCIA DE PAGAMENTO
// ========================================
export const createPaymentPreference = functions.https.onCall(async (data, context) => {
  try {
    // Verificar autenticação
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Usuário não autenticado');
    }

    const userId = context.auth.uid;
    const { packageId } = data;

    if (!packageId) {
      throw new functions.https.HttpsError('invalid-argument', 'Package ID é obrigatório');
    }

    // Buscar informações do pacote
    const packageDoc = await db.collection('credit_packages').doc(packageId).get();

    if (!packageDoc.exists) {
      throw new functions.https.HttpsError('not-found', 'Pacote não encontrado');
    }

    const packageData = packageDoc.data();
    const { name, credits, price, bonus_credits } = packageData!;

    // Buscar informações do usuário
    const userDoc = await db.collection('users').doc(userId).get();
    const userData = userDoc.data();

    // Criar preferência de pagamento no Mercado Pago
    const config = functions.config();
    const accessToken = config.mercadopago.access_token;

    const preference = {
      items: [
        {
          title: `Loomper - ${name}`,
          description: `${credits} créditos${bonus_credits ? ` + ${bonus_credits} bônus` : ''}`,
          quantity: 1,
          currency_id: 'BRL',
          unit_price: price,
        },
      ],
      payer: {
        email: userData?.email || '',
        name: userData?.display_name || '',
      },
      back_urls: {
        success: 'https://app.loomper.com.br/dashboard?payment=success',
        failure: 'https://app.loomper.com.br/dashboard?payment=failure',
        pending: 'https://app.loomper.com.br/dashboard?payment=pending',
      },
      auto_return: 'approved',
      external_reference: userId,
      metadata: {
        user_id: userId,
        package_id: packageId,
        credits: credits + (bonus_credits || 0),
      },
      notification_url: 'https://us-central1-loomper-e4c38.cloudfunctions.net/onMercadoPagoWebhook',
    };

    const response = await axios.post(
      'https://api.mercadopago.com/checkout/preferences',
      preference,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    console.log('✅ Preferência criada:', response.data);

    return {
      preferenceId: response.data.id,
      initPoint: response.data.init_point,
      sandboxInitPoint: response.data.sandbox_init_point,
    };

  } catch (error) {
    console.error('❌ Erro ao criar preferência:', error);
    throw new functions.https.HttpsError('internal', 'Erro ao criar preferência de pagamento');
  }
});

// ========================================
// 5. CRIAR USUÁRIO (onUserCreate)
// ========================================
export const onUserCreate = functions.auth.user().onCreate(async (user) => {
  try {
    const userId = user.uid;
    const email = user.email || '';
    const displayName = user.displayName || '';

    // Criar documento do usuário
    await db.collection('users').doc(userId).set({
      email: email,
      display_name: displayName,
      created_at: admin.firestore.FieldValue.serverTimestamp(),
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Criar wallet inicial
    await db.collection('users').doc(userId).collection('wallet').doc('current').set({
      paid_credits: 0,
      promotional_credits: 0,
      campaign_credits: 0,
      created_at: admin.firestore.FieldValue.serverTimestamp(),
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log(`✅ Usuário criado: ${userId}`);

  } catch (error) {
    console.error('❌ Erro ao criar usuário:', error);
  }
});

// ========================================
// 6. RENOVAR CRÉDITOS DE CAMPANHA (Cron)
// ========================================
export const renewCampaignCredits = functions.pubsub.schedule('0 0 1 * *').onRun(async (context) => {
  try {
    console.log('🔄 Renovando créditos de campanha...');

    // Buscar usuários com campanha ativa
    const usersSnapshot = await db.collection('users')
      .where('pioneer.status', '==', 'active')
      .get();

    let renewed = 0;

    for (const userDoc of usersSnapshot.docs) {
      const userId = userDoc.id;
      const pioneerData = userDoc.data().pioneer || {};
      const tier = pioneerData.tier; // 'founder', 'pioneer', 'early_adopter'
      const startDate = pioneerData.start_date?.toDate();
      const endDate = pioneerData.end_date?.toDate();

      if (!startDate || !endDate || new Date() > endDate) {
        // Campanha expirada
        await db.collection('users').doc(userId).update({
          'pioneer.status': 'expired',
        });
        continue;
      }

      // Verificar se usou pelo menos 1x no mês passado
      const lastMonthStart = new Date();
      lastMonthStart.setMonth(lastMonthStart.getMonth() - 1);
      lastMonthStart.setDate(1);
      const lastMonthEnd = new Date();
      lastMonthEnd.setDate(0);

      const transactionsSnapshot = await db.collection('users').doc(userId)
        .collection('credit_transactions')
        .where('type', '==', 'service_usage')
        .where('created_at', '>=', lastMonthStart)
        .where('created_at', '<=', lastMonthEnd)
        .limit(1)
        .get();

      if (transactionsSnapshot.empty) {
        console.log(`⚠️ Usuário ${userId} não usou a plataforma no mês passado. Pulando renovação.`);
        continue;
      }

      // Determinar quantidade de créditos a renovar
      let creditsToRenew = 0;
      if (tier === 'founder') creditsToRenew = 1500;
      else if (tier === 'pioneer') creditsToRenew = 1000;
      else if (tier === 'early_adopter') creditsToRenew = 1000;

      if (creditsToRenew === 0) continue;

      // Adicionar créditos de campanha
      await db.runTransaction(async (transaction) => {
        const walletRef = db.collection('users').doc(userId).collection('wallet').doc('current');
        const walletDoc = await transaction.get(walletRef);
        const currentCampaignCredits = walletDoc.exists ? (walletDoc.data()?.campaign_credits || 0) : 0;

        transaction.set(walletRef, {
          campaign_credits: currentCampaignCredits + creditsToRenew,
          updated_at: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });

        // Registrar transação
        const transactionRef = db.collection('users').doc(userId).collection('credit_transactions').doc();
        transaction.set(transactionRef, {
          type: 'campaign_renewal',
          amount: creditsToRenew,
          credit_type: 'campaign',
          tier: tier,
          expires_at: admin.firestore.Timestamp.fromMillis(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 dias
          status: 'completed',
          created_at: admin.firestore.FieldValue.serverTimestamp(),
        });
      });

      renewed++;
      console.log(`✅ ${creditsToRenew} créditos renovados para ${userId} (${tier})`);
    }

    console.log(`🎉 Renovação concluída: ${renewed} usuários`);

  } catch (error) {
    console.error('❌ Erro ao renovar créditos:', error);
  }
});

// ========================================
// 7. EXPIRAR CRÉDITOS PROMOCIONAIS (Cron)
// ========================================
export const expirePromotionalCredits = functions.pubsub.schedule('0 1 * * *').onRun(async (context) => {
  try {
    console.log('🗑️ Expirando créditos promocionais...');

    const now = admin.firestore.Timestamp.now();

    // Buscar transações expiradas
    const expiredTransactions = await db.collectionGroup('credit_transactions')
      .where('credit_type', '==', 'promotional')
      .where('expires_at', '<=', now)
      .where('status', '==', 'completed')
      .get();

    let expired = 0;

    for (const transactionDoc of expiredTransactions.docs) {
      const transactionData = transactionDoc.data();
      const userId = transactionDoc.ref.parent.parent!.id;
      const creditsToExpire = transactionData.amount;

      // Remover créditos da wallet
      await db.runTransaction(async (transaction) => {
        const walletRef = db.collection('users').doc(userId).collection('wallet').doc('current');
        const walletDoc = await transaction.get(walletRef);
        const currentPromoCredits = walletDoc.exists ? (walletDoc.data()?.promotional_credits || 0) : 0;

        const newPromoCredits = Math.max(0, currentPromoCredits - creditsToExpire);

        transaction.set(walletRef, {
          promotional_credits: newPromoCredits,
          updated_at: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });

        // Marcar transação como expirada
        transaction.update(transactionDoc.ref, {
          status: 'expired',
        });
      });

      expired++;
      console.log(`✅ ${creditsToExpire} créditos expirados do usuário ${userId}`);
    }

    console.log(`🎉 Expiração concluída: ${expired} transações`);

  } catch (error) {
    console.error('❌ Erro ao expirar créditos:', error);
  }
});
