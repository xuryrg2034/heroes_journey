﻿using Cysharp.Threading.Tasks;
using DG.Tweening;
using UnityEngine;
using UnityEngine.Events;

namespace Entities.Components
{
    public class Health
    {
        private int _value;

        public bool IsDead { get; private set; }

        public UnityEvent OnDie = new();

        public UnityEvent OnDamageTaken = new();

        public UnityEvent<int> OnValueChanged = new();
        
        public int MaxHealth { get; private set; }
        
        public int Value
        {
            get => _value;
            private set
            {
                _value = value;
                OnValueChanged.Invoke(_value);
            }
        }

        private Transform _transform;

        public Health(int health, Transform transform)
        {
            MaxHealth = Value = health;
            _transform = transform;
        }

        public void SetValue(int target)
        {
            Value = target;
        }

        public async UniTask TakeDamage(int damage)
        {
            Value -= damage;
            
            OnDamageTaken.Invoke();
            
            if (Value <= 0)
            {
                await Die();
            }
            else
            {
                await DamageAnimation();
            }
        }

        public async UniTask Die()
        {
            IsDead = true;
                
            await DieAnimation();
            
            OnDie.Invoke();
        }

        private UniTask DamageAnimation()
        {
            return _transform.DOShakePosition(0.2f, 0.4f).ToUniTask();
        }
        
        private UniTask DieAnimation()
        {
            return _transform.DOScale(0, 0.1f).ToUniTask();
        }
    }
    
    public enum DieReason
    {
        Undefined,
        Hero,
    }
}