using System;
using System.Collections.Generic;
using System.Linq;
using Core;
using Cysharp.Threading.Tasks;
using Grid;
using UnityEngine;
using UnityEngine.UIElements;

namespace Entities.Player
{
    public class ChainingBaseState : State
    {
        protected List<BaseEntity> SelectedEntities;
        protected Vector3Int StartPosition;
        protected Animator Animator;
        protected ChainingAbility Ability;
        protected Hero Owner;

        public ChainingBaseState(ChainingAbility ability, Hero owner)
        {
            Ability = ability;
            StartPosition = owner.GridPosition;
            Animator = owner.Animator;
            Owner = owner;
            SelectedEntities = Ability.SelectedEntities;
        }

        protected void _resetSelection()
        {
            SelectedEntities.Clear();
        }
    }
}