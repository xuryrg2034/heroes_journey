using System;
using System.Collections.Generic;
using Cysharp.Threading.Tasks;
using DG.Tweening;
using UnityEngine;
using UnityEngine.Events;

namespace Components.Entity
{
    public class Health
    {
        public UnityEvent OnDie = new();

        public UnityEvent OnDamageTaken = new();

        public int Value { get; private set; }

        private Transform _transform;

        public Health(int health, Transform transform)
        {
            Value = health;
            _transform = transform;
        }

        public void SetValue(int target)
        {
            Value = target;
        }

        public async UniTask TakeDamage(int damage)
        {
            if (Value <= 0) return;
            
            Value -= damage;
            
            OnDamageTaken.Invoke();
            await DamageAnimation();
            
            if (Value <= 0)
            {
                await DieAnimation();
                Die();
            }
        }
        
        public void Die()
        {
            OnDie?.Invoke();
        }

        private UniTask DamageAnimation()
        {
            return _transform.DOShakePosition(0.5f, 0.3f).ToUniTask();
        }
        
        private UniTask DieAnimation()
        {
            return _transform.DOScale(0, 0.3f).ToUniTask();
        }
    }
}