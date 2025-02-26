using System.Collections.Generic;
using Abilities.Hero;
using Components.Entity;
using UnityEngine;

namespace Core.Entities
{
    public class Hero : Entity
    {
        [SerializeField] private int damage;
        [SerializeField] private int energy;

        [SerializeReference, SubclassSelector]
        private List<BaseAbility> abilities = new();

        public List<BaseAbility> Abilities => abilities;
        
        public Damage Damage { get; private set; }

        public Energy Energy { get; private set; }

        public override void Init()
        {
            Damage = new Damage(damage);
            Energy = new Energy(energy);

            foreach (var ability in abilities)
            {
                ability.Init(this);
            }
        }
    }
}