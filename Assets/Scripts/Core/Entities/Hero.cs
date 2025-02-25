using Abilities.HeroAbilities;
using Components.Entity;
using UnityEngine;

namespace Core.Entities
{
    public class Hero : Entity
    {
        [SerializeField] private int damage;
        [SerializeField] private int energy;
        
        public BaseAbility[] Abilities { get; private set; }
        
        public Damage Damage { get; private set; }

        public Energy Energy { get; private set; }
        
        // protected override void Start()
        // {
        //     base.Start();
        // }

        public override void Init()
        {
            Damage = new Damage(damage);
            Energy = new Energy(energy);
            Abilities = new BaseAbility[]
            {
                new SlashAttack(this, "Slash")
            };
        }
    }
}