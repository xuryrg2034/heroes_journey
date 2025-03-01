﻿using System;
using Core.Entities;
using Cysharp.Threading.Tasks;
using DG.Tweening;
using UnityEngine;

namespace Abilities.EnemyAbilities
{
    [Serializable]
    public abstract class BaseAbility
    {
        [SerializeField] private bool enable = false;
        [SerializeField] private int order = 100;
        [SerializeField][Min(1)] protected int castTime;
        [HideInInspector] public Enemy Owner;

        protected  int _castCounter;
        protected State _state = State.Pending;
        
        public int Order => order;
        
        public bool Enable
        {   
            get => enable;
            set
            {
                enable = value;
            }
        }
        
        protected BaseAbility() {}

        protected bool _tryToExecute()
        {
            _castCounter += 1;
            var isReady = _castCounter > castTime;

            return isReady;
        }
        
        public abstract UniTask Execute();

        public abstract void Cancel();
        
        public virtual void Init(Enemy owner)
        {
            Owner = owner;
        }
        
        protected bool _isInRange(Vector2Int origin, Vector2Int target, int range)
        {
            var dx = Mathf.Abs(origin.x - target.x);
            var dy = Mathf.Abs(origin.y - target.y);

            // Используем челночное расстояние
            return Mathf.Max(dx, dy) <= range;
        }
    }

    public enum State
    {
        Pending,
        Preparing,
        Execute,
    }
}